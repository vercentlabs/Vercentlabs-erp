// HR & Payroll — after approval: posting to Finance, publishing payslips, paying salaries and statutory dues, and closing.
//
//   approved → posted → partially_paid → paid → closed
//
//   postPayrollRunToFinance   one journal through Finance's payroll contract (accounting/posting-rules/payroll.js): gross pay by department to
//                             salaries and wages, employer EPF / ESI to contribution expense; net pay to salaries payable; TDS, EPF, ESI and
//                             PT to their payables; any other deduction to its pay component's account (none set: refused, never a plug).
//   unpostPayrollRun          before any salary is paid: the journal is reversed in Finance and the run is cancelled — Finance journals a run
//                             once, so the corrected payroll is a new run of the period (a new revision), calculated and approved again.
//   publishPayslips           employees see their payslips (self-service) once published.
//   recordSalaryPayment       money actually paid, for chosen payslips (not held, not more than is owed): it posts once in Finance (Dr salaries
//                             payable, Cr the bank or cash account) and moves each payslip to partially paid / paid — a payment never adds to
//                             salary expense.
//   markPaymentException      a bank's rejection of one employee's transfer: the payslip waits to be paid again.
//   recordStatutoryPayment    a challan of TDS / EPF / ESI / PT for a pay month, not more than the month's payslips owe.
//   closePayrollRun           once every payslip is paid.
import { HrError, dateRequired, need, recordEvent, round2, text, textOrNull, uuid } from "../common.js";

export const PA = Object.freeze({ post: "hr_payroll.payroll.post", pay: "hr_payroll.payment.record", statutory: "hr_payroll.statutory.pay", prepare: "hr_payroll.payroll.prepare",
  approve: "hr_payroll.payroll.approve" });
const EPS = 0.005;
const finance = () => import("../../accounting/posting-rules/payroll.js");
// Payroll posts through Finance's payroll contract on its own behalf: with only the journal rights that contract needs (never wider access).
const financeContext = (c) => ({ ...c, permissions: [...(c.permissions ?? []), "accounting.view", "accounting.journal.create", "accounting.journal.post", "accounting.journal.approve", "accounting.journal.reverse"] });

async function loadRun(client, c, id) {
  const run = (await client.query(`SELECT * FROM tenant.hr_payroll_runs WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(id, "Payroll run")])).rows[0];
  if (!run) throw new HrError(404, "Payroll run was not found.", "HR_RUN_NOT_FOUND");
  return run;
}
const day = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10));

// What the run's payslips add up to, for the journal: gross and employer EPF / ESI by department, the statutory deductions, other deductions
// by their account, and the net pay.
export async function postingOf(client, c, run) {
  const slips = (await client.query(`SELECT p.id, p.gross_pay, p.net_pay, e.department_id, d.code AS department_code FROM tenant.hr_payslips p JOIN tenant.hr_employees e ON e.id = p.employee_id
      LEFT JOIN tenant.hr_departments d ON d.id = e.department_id WHERE p.payroll_run_id = $1 AND p.status <> 'cancelled'`, [run.id])).rows;
  const lines = (await client.query(`SELECT l.*, p.id AS slip_id, sc.accounting_account_id FROM tenant.hr_payslip_lines l JOIN tenant.hr_payslips p ON p.id = l.payslip_id
      LEFT JOIN tenant.hr_salary_components sc ON sc.id = l.salary_component_id OR (l.salary_component_id IS NULL AND sc.organization_id = l.organization_id AND sc.code = l.component_code)
     WHERE p.payroll_run_id = $1 AND p.status <> 'cancelled'`, [run.id])).rows;
  const dims = new Map((await client.query(`SELECT id, code FROM public.departments WHERE organization_id = $1`, [c.organizationId])).rows.map((r) => [r.code, r.id]));
  const byDept = new Map();
  const slipDept = new Map(slips.map((s) => [s.id, s.department_code ? dims.get(s.department_code) ?? null : null]));
  for (const s of slips) {
    const key = slipDept.get(s.id) ?? "none";
    const cur = byDept.get(key) ?? { departmentId: key === "none" ? null : key, gross: 0, employerEpf: 0, employerEsi: 0 };
    cur.gross += Number(s.gross_pay);
    byDept.set(key, cur);
  }
  const deductions = { tds: 0, employeeEpf: 0, employeeEsi: 0, pt: 0 };
  const others = new Map();
  for (const l of lines) {
    const dept = byDept.get(slipDept.get(l.slip_id) ?? "none");
    if (l.component_type === "employer_contribution") {
      if (["EPF_ER", "EPS_ER"].includes(l.component_code)) dept.employerEpf += Number(l.employer_amount);
      else if (l.component_code === "ESI_ER") dept.employerEsi += Number(l.employer_amount);
      continue;
    }
    if (l.component_type !== "deduction") continue;
    const amount = Number(l.amount);
    if (l.component_code === "TDS") deductions.tds += amount;
    else if (l.component_code === "EPF_EE") deductions.employeeEpf += amount;
    else if (l.component_code === "ESI_EE") deductions.employeeEsi += amount;
    else if (l.component_code === "PT") deductions.pt += amount;
    else {
      if (!l.accounting_account_id) throw new HrError(409, `The deduction ${l.component_code} (${l.component_name}) has no account: set it on the pay component (Pay components › Account), then post again.`, "HR_POSTING_ACCOUNT_MISSING");
      const cur = others.get(l.accounting_account_id) ?? { accountId: l.accounting_account_id, amount: 0, description: l.component_name };
      cur.amount += amount;
      others.set(l.accounting_account_id, cur);
    }
  }
  const money = (n) => round2(n).toFixed(2);
  return {
    lines: [...byDept.values()].map((d) => ({ departmentId: d.departmentId, gross: money(d.gross), employerEpf: money(d.employerEpf), employerEsi: money(d.employerEsi) })),
    deductions: Object.fromEntries(Object.entries(deductions).map(([k, v]) => [k, money(v)])),
    otherDeductions: [...others.values()].map((o) => ({ ...o, amount: money(o.amount) })),
    netPay: money(slips.reduce((n, s) => n + Number(s.net_pay), 0)),
  };
}

// input: { postingDate? (default the period's payment date) }
export async function postPayrollRunToFinance(client, c, id, input = {}) {
  need(c, PA.post);
  const run = await loadRun(client, c, id);
  if (run.status === "posted" || run.journal_entry_id) return { id: run.id, status: run.status, journalEntryId: run.journal_entry_id, replayed: true };
  if (run.status !== "approved") throw new HrError(409, "Only an approved payroll is posted.", "HR_RUN_STATE");
  const date = input.postingDate ? dateRequired(input.postingDate, "Posting date") : day(run.payment_date ?? run.period_end);
  const posting = await postingOf(client, c, run);
  const { postPayrollRun } = await finance();
  const journal = await postPayrollRun(client, financeContext(c), { payrollRunId: run.id, number: run.payroll_number, postingDate: date, period: `${day(run.period_start).slice(0, 7)}`, ...posting }, { internal: true });
  const journalId = journal?.id ?? journal?.journalEntryId ?? journal?.entry?.id ?? null;
  await client.query(`UPDATE tenant.hr_payroll_runs SET status = 'posted', journal_entry_id = $2, posted_by = $3, posted_at = now() WHERE id = $1`, [run.id, journalId, c.userId ?? null]);
  await client.query(`UPDATE tenant.hr_payslips SET status = 'posted' WHERE payroll_run_id = $1 AND status = 'approved'`, [run.id]);
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.posted", { journalEntryId: journalId, date });
  return { id: run.id, status: "posted", journalEntryId: journalId };
}
// input: { reason, accountingDate? }
export async function unpostPayrollRun(client, c, id, input = {}) {
  need(c, PA.post);
  const run = await loadRun(client, c, id);
  if (run.status !== "posted") throw new HrError(409, run.status === "partially_paid" || run.status === "paid" ? "Salaries were already paid from this posting: reverse the payments in Finance first." : "Only a posted payroll is unposted.", "HR_RUN_STATE");
  const reason = text(input.reason, 500);
  if (!reason) throw new HrError(400, "Give a reason.", "HR_REASON_REQUIRED");
  const { reversePayrollPosting } = await finance();
  await reversePayrollPosting(client, financeContext(c), { event: "payroll_run", sourceId: run.id, reason, accountingDate: input.accountingDate }, { internal: true });
  await client.query(`UPDATE tenant.hr_payroll_runs SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $2, unposted_reason = $2 WHERE id = $1`, [run.id, reason, c.userId ?? null]);
  await client.query(`UPDATE tenant.hr_payslips SET status = 'cancelled', released_at = NULL, published_at = NULL WHERE payroll_run_id = $1`, [run.id]);
  await client.query(`UPDATE tenant.hr_payroll_inputs SET payroll_run_id = NULL WHERE payroll_run_id = $1 AND status = 'approved'`, [run.id]);
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.unposted", { reason });
  return { id: run.id, status: "cancelled", note: "Reversed in Finance. Start a new run of the period for the corrected payroll." };
}
export async function publishPayslips(client, c, id) {
  need(c, PA.approve, PA.post);
  const run = await loadRun(client, c, id);
  if (!["approved", "posted", "partially_paid", "paid", "closed"].includes(run.status)) throw new HrError(409, "Payslips are published once the payroll is approved.", "HR_RUN_STATE");
  const n = (await client.query(`UPDATE tenant.hr_payslips SET published_at = COALESCE(published_at, now()), released_at = COALESCE(released_at, now()) WHERE payroll_run_id = $1 AND status NOT IN ('held', 'cancelled')
      RETURNING id`, [run.id])).rowCount;
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.published", { payslips: n });
  return { id: run.id, published: n };
}

async function refreshRun(client, run) {
  const s = (await client.query(`SELECT count(*) FILTER (WHERE status <> 'cancelled')::int AS slips, count(*) FILTER (WHERE status <> 'cancelled' AND payment_status = 'PAID')::int AS paid,
      COALESCE(sum(paid_amount), 0) AS amount FROM tenant.hr_payslips WHERE payroll_run_id = $1`, [run.id])).rows[0];
  const status = s.paid === s.slips && s.slips > 0 ? "paid" : Number(s.amount) > 0 ? "partially_paid" : run.status;
  await client.query(`UPDATE tenant.hr_payroll_runs SET status = $2, paid_amount = $3 WHERE id = $1`, [run.id, status, s.amount]);
  if (status === "paid") await client.query(`UPDATE tenant.hr_payroll_inputs SET status = 'paid' WHERE payroll_run_id = $1 AND status = 'approved'`, [run.id]);
  return status;
}
// input: { paymentDate, paidFromAccountId, method?, reference?, payslipIds? (default: every payslip still owed), amounts?: { [payslipId]: amount }, idempotencyKey? }
export async function recordSalaryPayment(client, c, id, input = {}) {
  need(c, PA.pay);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const prior = (await client.query(`SELECT id, payment_number FROM tenant.hr_salary_payments WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (prior) return { id: prior.id, number: prior.payment_number, replayed: true };
  }
  const run = await loadRun(client, c, id);
  if (!["posted", "partially_paid"].includes(run.status)) throw new HrError(409, run.status === "approved" ? "Post the payroll to Finance before recording its payment." : "This payroll is not awaiting payment.", "HR_RUN_STATE");
  const date = dateRequired(input.paymentDate, "Payment date");
  const accountId = uuid(input.paidFromAccountId, "Paid from");
  const method = ["bank_transfer", "cheque", "cash"].includes(input.method) ? input.method : "bank_transfer";
  const chosen = Array.isArray(input.payslipIds) && input.payslipIds.length ? input.payslipIds.map((x) => uuid(x, "Payslip")) : null;
  const slips = (await client.query(`SELECT * FROM tenant.hr_payslips WHERE payroll_run_id = $1 AND status NOT IN ('cancelled') AND payment_status <> 'PAID' ${chosen ? "AND id = ANY($2::uuid[])" : ""}
      ORDER BY payslip_number FOR UPDATE`, chosen ? [run.id, chosen] : [run.id])).rows;
  if (chosen && slips.length !== chosen.length) throw new HrError(409, "A chosen payslip is already paid or not in this payroll.", "HR_PAYMENT_INVALID");
  const held = slips.filter((s) => s.status === "held");
  if (held.length && chosen) throw new HrError(409, `${held.map((s) => s.payslip_number).join(", ")} is on hold: release it first.`, "HR_PAYMENT_HELD");
  const payable = slips.filter((s) => s.status !== "held");
  if (!payable.length) throw new HrError(409, "Nothing is left to pay in this payroll.", "HR_PAYMENT_INVALID");
  const lines = payable.map((s) => {
    const owed = round2(Number(s.net_pay) - Number(s.paid_amount));
    const amount = input.amounts?.[s.id] === undefined ? owed : round2(Number(input.amounts[s.id]));
    if (!(amount > 0) || amount > owed + EPS) throw new HrError(400, `${s.payslip_number}: pay between 0.01 and the ${owed} still owed.`, "HR_PAYMENT_INVALID");
    return { slip: s, amount };
  });
  const total = round2(lines.reduce((n, l) => n + l.amount, 0));
  const count = Number((await client.query(`SELECT count(*) AS n FROM tenant.hr_salary_payments WHERE payroll_run_id = $1`, [run.id])).rows[0].n);
  const number = `${run.payroll_number}-PAY${count + 1}`;
  const payment = (await client.query(`INSERT INTO tenant.hr_salary_payments (organization_id, payroll_run_id, payment_number, payment_date, paid_from_account_id, method, reference, amount, idempotency_key, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [c.organizationId, run.id, number, date, accountId, method, textOrNull(input.reference, 120), total, key, c.userId ?? null])).rows[0];
  const { postSalaryPayment } = await finance();
  const journal = await postSalaryPayment(client, financeContext(c), { paymentId: payment.id, number, paymentDate: date, amount: total.toFixed(2), paidFromAccountId: accountId, payrollRunNumber: run.payroll_number }, { internal: true });
  await client.query(`UPDATE tenant.hr_salary_payments SET journal_entry_id = $2 WHERE id = $1`, [payment.id, journal?.id ?? journal?.journalEntryId ?? null]);
  for (const l of lines) {
    await client.query(`INSERT INTO tenant.hr_salary_payment_lines (organization_id, payment_id, payslip_id, employee_id, amount) VALUES ($1,$2,$3,$4,$5)`, [c.organizationId, payment.id, l.slip.id, l.slip.employee_id, l.amount]);
    const paid = round2(Number(l.slip.paid_amount) + l.amount);
    await client.query(`UPDATE tenant.hr_payslips SET paid_amount = $2, payment_status = $3, payment_exception = NULL, status = CASE WHEN $3 = 'PAID' THEN 'paid' ELSE status END WHERE id = $1`,
      [l.slip.id, paid, paid + EPS >= Number(l.slip.net_pay) ? "PAID" : "PARTIALLY_PAID"]);
  }
  const status = await refreshRun(client, run);
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.paid", { number, amount: total, payslips: lines.length });
  return { id: payment.id, number, amount: total, runStatus: status, skippedHeld: held.map((s) => s.payslip_number) };
}
// input: { reason }
export async function markPaymentException(client, c, payslipId, input = {}) {
  need(c, PA.pay);
  const slip = (await client.query(`SELECT p.*, r.status AS run_status FROM tenant.hr_payslips p JOIN tenant.hr_payroll_runs r ON r.id = p.payroll_run_id WHERE p.organization_id = $1 AND p.id = $2 FOR UPDATE OF p`,
    [c.organizationId, uuid(payslipId, "Payslip")])).rows[0];
  if (!slip) throw new HrError(404, "Payslip was not found.", "HR_PAYSLIP_NOT_FOUND");
  if (!["posted", "partially_paid"].includes(slip.run_status) || slip.payment_status === "PAID") throw new HrError(409, "Only an unpaid payslip of a posted payroll is marked.", "HR_PAYSLIP_STATE");
  const reason = text(input.reason, 300);
  if (!reason) throw new HrError(400, "Give the reason (e.g. the bank's rejection).", "HR_REASON_REQUIRED");
  await client.query(`UPDATE tenant.hr_payslips SET payment_status = 'PAYMENT_EXCEPTION', payment_exception = $2 WHERE id = $1`, [slip.id, reason]);
  await recordEvent(client, c, "payslip", slip.id, "hr.payroll.payment_exception", { reason });
  return { id: slip.id };
}
// What the payslips of a pay month owe for one kind, less what was already deposited.
export async function statutoryOwed(client, c, kind, month) {
  const codes = { tds: ["TDS"], epf: ["EPF_EE", "EPF_ER", "EPS_ER"], esi: ["ESI_EE", "ESI_ER"], pt: ["PT"] }[kind];
  const due = Number((await client.query(`SELECT COALESCE(sum(l.amount + l.employer_amount), 0) AS q FROM tenant.hr_payslip_lines l JOIN tenant.hr_payslips p ON p.id = l.payslip_id
      JOIN tenant.hr_payroll_runs r ON r.id = p.payroll_run_id WHERE p.organization_id = $1 AND r.status IN ('posted', 'partially_paid', 'paid', 'closed') AND p.status <> 'cancelled'
      AND date_trunc('month', r.period_start) = $2::date AND l.component_code = ANY($3::text[])`, [c.organizationId, month, codes])).rows[0].q);
  const paid = Number((await client.query(`SELECT COALESCE(sum(amount), 0) AS q FROM tenant.hr_statutory_payments WHERE organization_id = $1 AND kind = $2 AND pay_month = $3`, [c.organizationId, kind, month])).rows[0].q);
  return { due: round2(due), paid: round2(paid), outstanding: round2(due - paid) };
}
// input: { kind, month (YYYY-MM), challanNumber, paymentDate, paidFromAccountId, amount?, note? }
export async function recordStatutoryPayment(client, c, input = {}) {
  need(c, PA.statutory);
  const kind = String(input.kind ?? "");
  if (!["tds", "epf", "esi", "pt"].includes(kind)) throw new HrError(400, "Choose TDS, EPF, ESI or Professional Tax.", "HR_PAYMENT_INVALID");
  const m = String(input.month ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) throw new HrError(400, "The pay month looks like 2026-09.", "HR_PAYMENT_INVALID");
  const month = `${m}-01`;
  const challan = text(input.challanNumber, 60);
  if (!challan) throw new HrError(400, "Enter the challan number.", "HR_PAYMENT_INVALID");
  const owed = await statutoryOwed(client, c, kind, month);
  const amount = input.amount === undefined || input.amount === "" ? owed.outstanding : round2(Number(input.amount));
  if (!(amount > 0) || amount > owed.outstanding + EPS) throw new HrError(409, `Only ${owed.outstanding} is owed for ${kind.toUpperCase()} of ${m} (posted payrolls ${owed.due}, deposited ${owed.paid}).`, "HR_PAYMENT_EXCEEDS_DUE");
  const date = dateRequired(input.paymentDate, "Payment date");
  const accountId = uuid(input.paidFromAccountId, "Paid from");
  let row;
  try {
    row = (await client.query(`INSERT INTO tenant.hr_statutory_payments (organization_id, kind, pay_month, challan_number, payment_date, paid_from_account_id, amount, note, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [c.organizationId, kind, month, challan, date, accountId, amount, textOrNull(input.note, 300), c.userId ?? null])).rows[0];
  } catch (error) {
    if (error.code === "23505") throw new HrError(409, `Challan ${challan} is already recorded.`, "HR_PAYMENT_DUPLICATE");
    throw error;
  }
  const { postStatutoryPayment } = await finance();
  const journal = await postStatutoryPayment(client, financeContext(c), { paymentId: row.id, number: challan, kind, paymentDate: date, amount: amount.toFixed(2), paidFromAccountId: accountId }, { internal: true });
  await client.query(`UPDATE tenant.hr_statutory_payments SET journal_entry_id = $2 WHERE id = $1`, [row.id, journal?.id ?? journal?.journalEntryId ?? null]);
  await recordEvent(client, c, "statutory_payment", row.id, "hr.payroll.statutory_paid", { kind, month: m, challan, amount });
  return { id: row.id, amount, outstanding: round2(owed.outstanding - amount) };
}
export async function closePayrollRun(client, c, id) {
  need(c, PA.post, PA.approve);
  const run = await loadRun(client, c, id);
  if (run.status === "closed") return { id: run.id, status: "closed", replayed: true };
  if (run.status !== "paid") throw new HrError(409, "A payroll closes once every payslip is paid.", "HR_RUN_STATE");
  await client.query(`UPDATE tenant.hr_payroll_runs SET status = 'closed', closed_by = $2, closed_at = now() WHERE id = $1`, [run.id, c.userId ?? null]);
  await recordEvent(client, c, "payroll_run", run.id, "hr.payroll.closed", {});
  return { id: run.id, status: "closed" };
}
