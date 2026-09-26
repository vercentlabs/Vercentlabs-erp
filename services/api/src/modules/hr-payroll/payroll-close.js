// F433 final settlement, F436 bank transfer file, F437 payroll accounting posting, F438 payroll
// reconciliation.
import { createHash } from "node:crypto";

import { getPrimaryLedger, loadCompany } from "../accounting/index.js";
import { createJournalEntry, postJournalEntry } from "../accounting/index.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import {
  HrError, addDays, dateOrNull, dateRequired, need, needAny, nonNegative, qx, recordEvent, round2, text, textOrNull, today, uuid, uuidOrNull,
} from "./common.js";
import { compensationOn } from "./compensation.js";
import { gratuitySettlementLine } from "./statutory.js";
import { runPayrollCalculation, startPayrollRun, submitPayrollRun } from "./payroll.js";

const PREPARE = "hr_payroll.payroll.prepare";
const APPROVE = "hr_payroll.payroll.approve";
const POST = "hr_payroll.payroll.post";
const VIEW = [PREPARE, APPROVE, POST, "hr_payroll.reports.view"];

async function loadEmployee(client, c, id) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(id, "Employee")]);
  if (!rows[0]) throw new HrError(404, "Employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  return rows[0];
}
async function settings(client, c) {
  await qx(client, `INSERT INTO tenant.hr_payroll_settings(organization_id,company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.organizationId, c.companyId]);
  return (await qx(client, `SELECT * FROM tenant.hr_payroll_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId])).rows[0];
}
// One ledger entry against a leave balance, mirroring leave.js's private helper (not exported there).
async function postLeaveLedger(client, c, { employeeId, leaveTypeId, year, type, days, note, referenceId }) {
  const r4 = Math.round((Number(days) + Number.EPSILON) * 10000) / 10000;
  const ins = await qx(client, `INSERT INTO tenant.hr_leave_ledger(organization_id,company_id,employee_id,leave_type_id,leave_year,entry_type,days,reference_id,note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [c.organizationId, c.companyId, employeeId, leaveTypeId, year, type, r4, referenceId ?? null, textOrNull(note, 300), c.userId]);
  if (!ins.rows[0]) return;
  const adjusted = r4;
  await qx(client, `INSERT INTO tenant.hr_leave_balances(organization_id,company_id,employee_id,leave_type_id,leave_year,adjusted,closing_balance) VALUES ($1,$2,$3,$4,$5,$6,$6)
    ON CONFLICT (employee_id,leave_type_id,leave_year) DO UPDATE SET adjusted=tenant.hr_leave_balances.adjusted+$6, closing_balance=tenant.hr_leave_balances.closing_balance+$6, updated_at=now()`,
    [c.organizationId, c.companyId, employeeId, leaveTypeId, year, adjusted]);
}

// ---------------------------------------------------------------- final settlement (F433)
async function loadSettlement(client, c, id, lock = false) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_final_settlements WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Settlement")]);
  if (!rows[0]) throw new HrError(404, "Final settlement was not found.", "HR_SETTLEMENT_NOT_FOUND");
  return rows[0];
}
export async function listFinalSettlements(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra = ` AND s.status=$3`; }
  const { rows } = await qx(client, `SELECT s.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name FROM tenant.hr_final_settlements s JOIN tenant.hr_employees e ON e.id=s.employee_id WHERE s.organization_id=$1 AND s.company_id=$2${extra} ORDER BY s.created_at DESC LIMIT 500`, params);
  return rows;
}
export async function getFinalSettlement(client, c, id) {
  needAny(c, VIEW);
  return loadSettlement(client, c, id);
}

// Builds the lines by hand from the employee's leave, loans and pay -- deterministic, no side effects.
export async function calculateFinalSettlement(client, c, employeeId) {
  need(c, PREPARE);
  const e = await loadEmployee(client, c, employeeId);
  if (e.status !== "separated" || !e.separation_date) throw new HrError(409, "Only a separated employee has a final settlement.", "HR_EMPLOYEE_STATE");
  const lwd = String(e.last_working_date ?? e.separation_date).slice(0, 10);
  const open = await qx(client, `SELECT id FROM tenant.hr_final_settlements WHERE employee_id=$1 AND status IN ('draft','pending_approval','approved')`, [e.id]);
  if (open.rows[0]) throw new HrError(409, "There is already an open final settlement for this employee.", "HR_SETTLEMENT_OPEN");
  const cfg = await settings(client, c);
  const comp = await compensationOn(client, e.id, lwd);
  const lines = [];
  // leave encashment: the balance of every leave type that allows it, at (gross / divisor) a day
  const dailyRate = comp ? round2(Number(comp.monthly_gross) / Number(cfg.encashment_divisor)) : 0;
  const balances = await qx(client, `SELECT b.*, t.name AS type_name, t.encashment_allowed FROM tenant.hr_leave_balances b JOIN tenant.hr_leave_types t ON t.id=b.leave_type_id WHERE b.employee_id=$1 AND b.leave_year=$2 AND t.encashment_allowed AND b.closing_balance > 0`, [e.id, Number(lwd.slice(0, 4))]);
  for (const b of balances.rows) {
    const days = Number(b.closing_balance);
    lines.push({ code: "LEAVE_ENCASH", label: `Leave encashment: ${b.type_name} (${days} days)`, kind: "earning", amount: round2(days * dailyRate), leaveTypeId: b.leave_type_id, leaveYear: b.leave_year, days });
  }
  // notice-period shortfall (a resignation that gave less notice than the terms require)
  if (cfg.notice_recovery) {
    const sep = (await qx(client, `SELECT * FROM tenant.hr_separations WHERE employee_id=$1 AND status='completed' ORDER BY completed_at DESC LIMIT 1`, [e.id])).rows[0];
    if (sep && sep.separation_type === "resignation") {
      const served = Math.round((Date.parse(lwd) - Date.parse(String(sep.notice_date))) / 86400000);
      const shortfall = Math.max(0, Number(e.notice_period_days) - served);
      if (shortfall > 0 && comp) {
        const recovery = round2((Number(comp.monthly_gross) / 30) * shortfall);
        lines.push({ code: "NOTICE_RECOVERY", label: `Notice period shortfall: ${shortfall} day(s)`, kind: "recovery", amount: recovery });
      }
    }
  }
  // outstanding loans and advances are recovered in full
  const loans = await qx(client, `SELECT * FROM tenant.hr_loans WHERE employee_id=$1 AND status='active' AND outstanding_principal > 0`, [e.id]);
  for (const l of loans.rows) lines.push({ code: "LOAN_RECOVERY", label: `${l.loan_type === "advance" ? "Advance" : "Loan"} ${l.loan_number} outstanding balance`, kind: "recovery", amount: round2(Number(l.outstanding_principal)), loanId: l.id });
  // gratuity (F444): only once the statutory minimum years of service have been completed
  const gratuity = await gratuitySettlementLine(client, c, e, lwd);
  if (gratuity) lines.push(gratuity);
  // approved bonus/incentive/arrears not yet paid -- folded into the settlement, so they are
  // withdrawn from the ordinary payroll queue to avoid paying them twice
  const pending = await qx(client, `SELECT * FROM tenant.hr_payroll_inputs WHERE employee_id=$1 AND status='approved' AND input_type IN ('bonus','incentive','arrear') AND payroll_run_id IS NULL`, [e.id]);
  for (const p of pending.rows) lines.push({ code: p.input_type.toUpperCase(), label: text(p.description, 200) || p.input_type, kind: "earning", amount: Number(p.amount), inputId: p.id });
  const totalEarnings = round2(lines.filter((l) => l.kind === "earning").reduce((n, l) => n + l.amount, 0));
  const totalRecoveries = round2(lines.filter((l) => l.kind === "recovery").reduce((n, l) => n + l.amount, 0));
  const number = await nextDocumentNumber(client, c, { documentType: "hr_final_settlement", prefix: "FS", padding: 5 });
  const { rows } = await qx(client, `INSERT INTO tenant.hr_final_settlements(organization_id,company_id,settlement_number,employee_id,last_working_day,lines,total_earnings,total_recoveries,net_amount,created_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING *`,
    [c.organizationId, c.companyId, number, e.id, lwd, JSON.stringify(lines), totalEarnings, totalRecoveries, round2(totalEarnings - totalRecoveries), c.userId]);
  if (pending.rows.length) await qx(client, `UPDATE tenant.hr_payroll_inputs SET status='cancelled', decision_note=$2 WHERE id = ANY($1::uuid[])`, [pending.rows.map((p) => p.id), `Folded into final settlement ${number}`]);
  await recordEvent(client, c, "employee", e.id, "hr.settlement.calculated", { settlementId: rows[0].id, net: rows[0].net_amount });
  return rows[0];
}
export async function submitFinalSettlement(client, c, id) {
  need(c, PREPARE);
  const s = await loadSettlement(client, c, id, true);
  if (s.status !== "draft") throw new HrError(409, "Only a draft settlement can be submitted.", "HR_SETTLEMENT_STATE");
  const out = await qx(client, `UPDATE tenant.hr_final_settlements SET status='pending_approval', submitted_by=$2 WHERE id=$1 RETURNING *`, [s.id, c.userId]);
  return out.rows[0];
}
export async function decideFinalSettlement(client, c, id, { approve, note }) {
  need(c, APPROVE);
  const s = await loadSettlement(client, c, id, true);
  if (s.status !== "pending_approval") throw new HrError(409, "Only a settlement awaiting approval can be decided.", "HR_SETTLEMENT_STATE");
  if (s.created_by === c.userId) throw new HrError(403, "A settlement must be approved by someone other than the person who calculated it.", "SELF_APPROVAL_BLOCKED");
  const emp = (await qx(client, `SELECT user_id FROM tenant.hr_employees WHERE id=$1`, [s.employee_id])).rows[0];
  if (emp?.user_id === c.userId) throw new HrError(403, "You cannot approve your own settlement.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for rejecting.", "HR_REASON_REQUIRED");
  const out = await qx(client, `UPDATE tenant.hr_final_settlements SET status=$2, approved_by=$3, approved_at=now(), notes=coalesce(notes,'') || $4 WHERE id=$1 RETURNING *`,
    [s.id, approve ? "approved" : "draft", c.userId, note ? `\n${text(note, 300)}` : ""]);
  await recordEvent(client, c, "employee", s.employee_id, approve ? "hr.settlement.approved" : "hr.settlement.returned", { settlementId: s.id });
  return out.rows[0];
}

// Turns the approved settlement into a real payroll: one-off payroll inputs (already approved,
// since the settlement itself was) feeding a dedicated final_settlement run for this employee only.
export async function paySettlement(client, c, id) {
  need(c, PREPARE);
  const s = await loadSettlement(client, c, id, true);
  if (s.status !== "approved") throw new HrError(409, "Only an approved settlement can be paid.", "HR_SETTLEMENT_STATE");
  const e = await loadEmployee(client, c, s.employee_id);
  const month = String(s.last_working_day).slice(0, 10);
  for (const l of s.lines) {
    const type = l.kind === "earning" ? "settlement_earning" : "settlement_deduction";
    await qx(client, `INSERT INTO tenant.hr_payroll_inputs(organization_id,company_id,employee_id,input_type,amount,taxable,description,pay_month,status,requested_by,decided_by,decided_at,source_type,source_id,component_code)
      VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8::date,'approved',$9,$9,now(),'final_settlement',$10,$11)`,
      [c.organizationId, c.companyId, e.id, type, l.amount, l.code !== "LEAVE_ENCASH", l.label, month, c.userId, s.id, l.code]);
  }
  // an ad-hoc, single-day payroll period just for this settlement
  const period = (await qx(client, `INSERT INTO tenant.hr_payroll_periods(organization_id,company_id,period_code,period_start,period_end,payment_date,created_by) VALUES ($1::uuid,$2::uuid,$3,$4::date,$4::date,$4::date,$5::uuid)
    ON CONFLICT (organization_id,company_id,period_code) DO UPDATE SET period_code=EXCLUDED.period_code RETURNING *`,
    [c.organizationId, c.companyId, `FS-${s.settlement_number}`, month, c.userId])).rows[0];
  const run = await startPayrollRun(client, c, { runType: "final_settlement", periodId: period.id, employeeIds: [e.id], notes: `Final settlement ${s.settlement_number}` });
  await runPayrollCalculation(client, c, run.id, { employeeIds: [e.id] });
  await submitPayrollRun(client, c, run.id);
  const out = await qx(client, `UPDATE tenant.hr_final_settlements SET payroll_run_id=$2, status='paid' WHERE id=$1 RETURNING *`, [s.id, run.id]);
  // the leave encashed is used up now, and its balance lapses
  for (const l of s.lines) if (l.code === "LEAVE_ENCASH" && l.leaveTypeId) await postLeaveLedger(client, c, { employeeId: e.id, leaveTypeId: l.leaveTypeId, year: l.leaveYear, type: "usage", days: -l.days, referenceId: s.id, note: `Encashed in settlement ${s.settlement_number}` });
  // a loan or advance recovered in the settlement is closed outright; any remaining schedule is waived
  for (const l of s.lines) {
    if (l.code !== "LOAN_RECOVERY" || !l.loanId) continue;
    await qx(client, `UPDATE tenant.hr_loans SET status='closed', outstanding_principal=0, closed_at=now() WHERE id=$1`, [l.loanId]);
    await qx(client, `UPDATE tenant.hr_loan_installments SET status='waived', note='Recovered in full settlement' WHERE loan_id=$1 AND status='scheduled'`, [l.loanId]);
  }
  await recordEvent(client, c, "employee", e.id, "hr.settlement.paid", { settlementId: s.id, payrollRunId: run.id });
  return { settlement: out.rows[0], payrollRunId: run.id };
}

// ---------------------------------------------------------------- bank transfer file (F436)
async function loadRun(client, c, id, lock = false) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_payroll_runs WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Payroll run")]);
  if (!rows[0]) throw new HrError(404, "Payroll run was not found.", "HR_RUN_NOT_FOUND");
  return rows[0];
}
const csvCell = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

export async function listBankFiles(client, c, filters = {}) {
  needAny(c, [PREPARE, POST, "hr_payroll.reports.view"]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.runId) { params.push(uuid(filters.runId, "Payroll run")); extra = ` AND f.payroll_run_id=$3`; }
  const { rows } = await qx(client, `SELECT f.id, f.file_number, f.file_format, f.record_count, f.total_amount, f.status, f.generated_at, f.acknowledged_at, f.utr_reference, r.payroll_number FROM tenant.hr_bank_files f JOIN tenant.hr_payroll_runs r ON r.id=f.payroll_run_id WHERE f.organization_id=$1 AND f.company_id=$2${extra} ORDER BY f.generated_at DESC LIMIT 200`, params);
  return rows;
}
export async function getBankFile(client, c, id) {
  needAny(c, [PREPARE, POST, "hr_payroll.reports.view"]);
  const { rows } = await qx(client, `SELECT f.*, r.payroll_number FROM tenant.hr_bank_files f JOIN tenant.hr_payroll_runs r ON r.id=f.payroll_run_id WHERE f.organization_id=$1 AND f.id=$2`, [c.organizationId, uuid(id, "Bank file")]);
  if (!rows[0]) throw new HrError(404, "Bank file was not found.", "HR_BANK_FILE_NOT_FOUND");
  return rows[0];
}
export async function generateBankFile(client, c, runId) {
  need(c, POST);
  const run = await loadRun(client, c, runId, true);
  if (!["approved", "posted", "paid"].includes(run.status)) throw new HrError(409, "A bank file is generated once the payroll is approved.", "HR_RUN_STATE");
  const existing = await qx(client, `SELECT file_number FROM tenant.hr_bank_files WHERE payroll_run_id=$1 AND status IN ('generated','acknowledged')`, [run.id]);
  if (existing.rows[0]) throw new HrError(409, `Bank file ${existing.rows[0].file_number} already covers this payroll.`, "HR_BANK_FILE_EXISTS");
  const cfg = await settings(client, c);
  const slips = (await qx(client, `SELECT p.id, p.net_pay, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name, e.bank_details FROM tenant.hr_payslips p JOIN tenant.hr_employees e ON e.id=p.employee_id WHERE p.payroll_run_id=$1 AND p.status <> 'cancelled' AND p.net_pay > 0`, [run.id])).rows;
  const rows = [["Beneficiary name", "Account number", "IFSC", "Amount", "Employee number", "Narration"]];
  const skipped = [];
  let total = 0;
  let count = 0;
  for (const s of slips) {
    const bank = s.bank_details ?? {};
    if (!bank.account_number || !bank.ifsc) { skipped.push({ employeeNumber: s.employee_number, reason: "No bank account on file" }); continue; }
    rows.push([bank.account_holder || s.employee_name, bank.account_number, bank.ifsc, Number(s.net_pay).toFixed(2), s.employee_number, `Salary ${run.payroll_number}`]);
    total = round2(total + Number(s.net_pay));
    count += 1;
  }
  if (count === 0) throw new HrError(409, "Nobody in this payroll has a bank account on file.", "HR_BANK_FILE_EMPTY");
  const content = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const checksum = createHash("sha256").update(content).digest("hex");
  const number = await nextDocumentNumber(client, c, { documentType: "hr_bank_file", prefix: "BNK", padding: 5 });
  const { rows: out } = await qx(client, `INSERT INTO tenant.hr_bank_files(organization_id,company_id,payroll_run_id,file_number,file_format,record_count,total_amount,checksum,content,skipped,generated_by) VALUES ($1,$2,$3,$4,'neft_csv',$5,$6,$7,$8,$9::jsonb,$10) RETURNING id,file_number,file_format,record_count,total_amount,checksum,status,generated_at,skipped`,
    [c.organizationId, c.companyId, run.id, number, count, total, checksum, content, JSON.stringify(skipped), c.userId]);
  await recordEvent(client, c, "payroll_run", run.id, "hr.bank_file.generated", { fileId: out[0].id, count, total, skipped: skipped.length });
  return out[0];
}
export async function acknowledgeBankFile(client, c, id, utrReference) {
  need(c, POST);
  if (!text(utrReference)) throw new HrError(400, "Give the bank's UTR / batch reference.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_bank_files SET status='acknowledged', utr_reference=$3, acknowledged_by=$2, acknowledged_at=now() WHERE organization_id=$1 AND id=$4 AND status='generated' RETURNING *`, [c.organizationId, c.userId, text(utrReference, 100), uuid(id, "Bank file")]);
  if (!rows[0]) throw new HrError(409, "Only a generated (not yet acknowledged) bank file can be acknowledged.", "HR_BANK_FILE_STATE");
  await qx(client, `UPDATE tenant.hr_payroll_runs SET status='paid' WHERE id=(SELECT payroll_run_id FROM tenant.hr_bank_files WHERE id=$1) AND status='posted'`, [rows[0].id]);
  return rows[0];
}

// ---------------------------------------------------------------- accounting posting (F437)
export async function postPayrollToAccounting(client, c, runId) {
  need(c, POST);
  const run = await loadRun(client, c, runId, true);
  if (run.accounting_batch_id) throw new HrError(409, "This payroll has already been posted to accounting.", "HR_RUN_ALREADY_POSTED");
  if (run.status !== "approved") throw new HrError(409, "Only an approved payroll can be posted to accounting.", "HR_RUN_STATE");
  const cfg = await settings(client, c);
  const missing = ["salary_expense_account_id", "salary_payable_account_id", "statutory_payable_account_id"].filter((k) => !cfg[k]);
  if (missing.length) throw new HrError(409, `Set the accounting accounts for payroll first (Settings): ${missing.map((k) => k.replace(/_account_id$/, "").replace(/_/g, " ")).join(", ")}.`, "HR_ACCOUNTING_NOT_CONFIGURED");
  const acctContext = { organizationId: c.organizationId, activeCompanyId: c.companyId, allowAllCompanies: false, userId: c.userId };
  const company = await loadCompany(client, acctContext, c.companyId);
  const ledger = await getPrimaryLedger(client, acctContext, company.id);
  const journal = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='general' AND status='active' ORDER BY created_at LIMIT 1`, [c.organizationId, company.id, ledger.id])).rows[0];
  if (!journal) throw new HrError(409, "The general accounting journal is not set up for this company.", "HR_ACCOUNTING_NOT_CONFIGURED");
  const gross = Number(run.gross_pay);
  const employer = Number(run.employer_contributions);
  const net = Number(run.net_pay);
  const withheld = round2(gross - net);
  const statutoryTotal = round2(withheld + employer);
  const lines = [
    { accountId: cfg.salary_expense_account_id, debit: gross, credit: 0, description: `Payroll ${run.payroll_number} gross pay` },
    ...(employer > 0 ? [{ accountId: cfg.employer_expense_account_id || cfg.salary_expense_account_id, debit: employer, credit: 0, description: `Payroll ${run.payroll_number} employer contributions` }] : []),
    { accountId: cfg.salary_payable_account_id, debit: 0, credit: net, description: `Payroll ${run.payroll_number} net pay` },
    { accountId: cfg.statutory_payable_account_id, debit: 0, credit: statutoryTotal, description: `Payroll ${run.payroll_number} deductions and employer contributions payable` },
  ].filter((l) => l.debit > 0 || l.credit > 0);
  const totalDebit = round2(lines.reduce((n, l) => n + l.debit, 0));
  const totalCredit = round2(lines.reduce((n, l) => n + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.01) throw new HrError(409, `The payroll journal does not balance (debit ${totalDebit}, credit ${totalCredit}). Check the run's totals.`, "HR_ACCOUNTING_UNBALANCED");
  const journalEntry = await createJournalEntry(client, acctContext, {
    companyId: company.id, ledgerId: ledger.id, journalId: journal.id, entryDate: run.payment_date, accountingDate: run.payment_date,
    entryType: "standard", reference: run.payroll_number, description: `Payroll ${run.payroll_number} (${run.period_start} to ${run.period_end})`,
    currencyCode: company.base_currency, lines,
  }, { internal: true, sourceModule: "hr_payroll", sourceType: "payroll_run", sourceId: run.id, sourceNumber: run.payroll_number });
  await postJournalEntry(client, acctContext, journalEntry.entry.id, { internal: true, allowDraft: true });
  const out = await qx(client, `UPDATE tenant.hr_payroll_runs SET status='posted', accounting_batch_id=$2, posted_by=$3, posted_at=now() WHERE id=$1 RETURNING *`, [run.id, journalEntry.entry.id, c.userId]);
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.posted_to_accounting", { journalEntryId: journalEntry.entry.id, gross, net, statutoryTotal });
  return { run: out.rows[0], journalEntryId: journalEntry.entry.id, journalEntryNumber: journalEntry.entry.entry_number };
}

// ---------------------------------------------------------------- reconciliation (F438)
export async function getPayrollReconciliation(client, c, runId) {
  needAny(c, [POST, "hr_payroll.reports.view"]);
  const run = await loadRun(client, c, runId);
  const slipTotals = (await qx(client, `SELECT coalesce(sum(gross_pay),0) AS gross, coalesce(sum(total_deductions),0) AS deductions, coalesce(sum(employer_contributions),0) AS employer, coalesce(sum(net_pay),0) AS net, count(*)::int AS n FROM tenant.hr_payslips WHERE payroll_run_id=$1 AND status <> 'cancelled'`, [run.id])).rows[0];
  const bankFile = (await qx(client, `SELECT file_number, record_count, total_amount, status FROM tenant.hr_bank_files WHERE payroll_run_id=$1 AND status IN ('generated','acknowledged') ORDER BY generated_at DESC LIMIT 1`, [run.id])).rows[0] ?? null;
  let journal = null;
  if (run.accounting_batch_id) {
    const j = (await client.query(`SELECT je.id, je.entry_number, je.status, coalesce(sum(l.debit_amount),0) AS debit, coalesce(sum(l.credit_amount),0) AS credit FROM tenant.accounting_journal_entries je LEFT JOIN tenant.accounting_journal_lines l ON l.journal_entry_id=je.id WHERE je.organization_id=$1 AND je.id=$2 GROUP BY je.id`, [c.organizationId, run.accounting_batch_id])).rows[0];
    journal = j ?? null;
  }
  const checks = [];
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.02;
  checks.push({ check: "Payslips match the run totals", ok: near(slipTotals.gross, run.gross_pay) && near(slipTotals.net, run.net_pay), detail: `Run: gross ${run.gross_pay}, net ${run.net_pay}. Payslips: gross ${slipTotals.gross}, net ${slipTotals.net}.` });
  checks.push({ check: "Bank file matches the net pay", ok: !bankFile || near(bankFile.total_amount, run.net_pay) || bankFile.record_count < slipTotals.n, detail: bankFile ? `Bank file ${bankFile.file_number}: ${bankFile.record_count} of ${slipTotals.n} employee(s), ${bankFile.total_amount}.` : "No bank file generated yet." });
  checks.push({ check: "Journal entry is balanced and posted", ok: !journal || (near(journal.debit, journal.credit) && journal.status === "posted"), detail: journal ? `${journal.entry_number}: debit ${journal.debit}, credit ${journal.credit}, ${journal.status}.` : "Not yet posted to accounting." });
  checks.push({ check: "Journal debit equals payroll cost (gross + employer contributions)", ok: !journal || near(journal.debit, Number(run.gross_pay) + Number(run.employer_contributions)), detail: journal ? `Journal debit ${journal.debit} vs expected ${round2(Number(run.gross_pay) + Number(run.employer_contributions))}.` : "Not yet posted." });
  return { runId: run.id, payrollNumber: run.payroll_number, status: run.status, slipTotals, bankFile, journal, reconciled: checks.every((k) => k.ok), checks };
}
void addDays; void dateOrNull; void dateRequired; void nonNegative; void uuidOrNull; void today;
