import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  asDatabaseDecimal,
  decimal,
  event,
  getPrimaryLedger,
  isoDate,
  loadCompany,
  requirePermission,
  requiredText,
  text,
  uuid,
} from "./core.js";
import { div } from "./money.js";
import { createJournalEntry, postJournalEntry } from "./journals.js";

function addMonths(dateValue, months) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, monthEnd));
  return date.toISOString().slice(0, 10);
}

function recognitionDates(startDate, endDate, frequency) {
  const increment = frequency === "quarterly" ? 3 : frequency === "yearly" ? 12 : 1;
  const dates = [];
  let cursor = startDate;
  while (cursor <= endDate && dates.length < 1200) {
    dates.push(cursor);
    cursor = addMonths(cursor, increment);
  }
  if (dates.at(-1) !== endDate && endDate > startDate) dates.push(endDate);
  return [...new Set(dates)];
}

async function loadSchedule(client, context, scheduleIdValue, lock = false) {
  const scheduleId = uuid(scheduleIdValue, "Accrual schedule");
  const result = await client.query(
    `SELECT schedule.*,source_account.ledger_id,company.base_currency
       FROM tenant.accounting_accrual_schedules schedule
       JOIN tenant.accounting_accounts source_account ON source_account.id=schedule.source_account_id
       JOIN public.companies company ON company.id=schedule.company_id
      WHERE schedule.organization_id=$1 AND schedule.id=$2${lock ? " FOR UPDATE OF schedule" : ""}`,
    [context.organizationId, scheduleId],
  );
  const schedule = result.rows[0];
  if (!schedule) throw new AccountingError(404, "Accrual schedule was not found.");
  if (!context.allowAllCompanies && context.activeCompanyId && schedule.company_id !== context.activeCompanyId) {
    throw new AccountingError(403, "Switch to the schedule company before continuing.");
  }
  return schedule;
}

export async function createAccrualSchedule(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.recurringManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const sourceAccountId = uuid(input.sourceAccountId, "Source account");
  const targetAccountId = uuid(input.targetAccountId, "Target account");
  if (sourceAccountId === targetAccountId) throw new AccountingError(400, "Source and target accounts must differ.");
  const accounts = await client.query(
    `SELECT id FROM tenant.accounting_accounts
      WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND id=ANY($4::uuid[])
        AND is_group=false AND status='active'`,
    [context.organizationId, company.id, ledger.id, [sourceAccountId, targetAccountId]],
  );
  if (accounts.rows.length !== 2) throw new AccountingError(409, "Accrual accounts must be active posting accounts in the company ledger.");
  const startDate = isoDate(input.startDate, "Start date");
  const endDate = isoDate(input.endDate, "End date");
  if (endDate < startDate) throw new AccountingError(400, "End date must be on or after start date.");
  const scheduleType = ["accrual", "deferred_expense", "deferred_revenue"].includes(input.scheduleType)
    ? input.scheduleType
    : "accrual";
  const frequency = ["monthly", "quarterly", "yearly", "custom"].includes(input.frequency)
    ? input.frequency
    : "monthly";
  const totalAmount = decimal(input.totalAmount);
  if (totalAmount <= 0n) throw new AccountingError(400, "Schedule amount must be positive.");
  const result = await client.query(
    `INSERT INTO tenant.accounting_accrual_schedules (
      organization_id,company_id,code,name,schedule_type,source_type,source_id,start_date,end_date,total_amount,
      source_account_id,target_account_id,frequency,status,created_by,updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$14) RETURNING *`,
    [context.organizationId, company.id, requiredText(input.code, "Schedule code", 50),
      requiredText(input.name, "Schedule name", 200), scheduleType, text(input.sourceType, 100) || null,
      input.sourceId ? uuid(input.sourceId, "Source") : null, startDate, endDate, asDatabaseDecimal(totalAmount),
      sourceAccountId, targetAccountId, frequency, context.userId],
  );
  const dates = recognitionDates(startDate, endDate, frequency);
  const regularAmount = div(totalAmount, dates.length);
  let allocated = 0n;
  for (let index = 0; index < dates.length; index += 1) {
    const amount = index === dates.length - 1 ? totalAmount - allocated : regularAmount;
    allocated += amount;
    await client.query(
      `INSERT INTO tenant.accounting_accrual_recognitions (
        organization_id,schedule_id,recognition_date,amount,status,created_by
      ) VALUES ($1,$2,$3,$4,'planned',$5)
      ON CONFLICT (organization_id,schedule_id,recognition_date) DO NOTHING`,
      [context.organizationId, result.rows[0].id, dates[index], asDatabaseDecimal(amount), context.userId],
    );
  }
  await event(client, context, "accrual_schedule", result.rows[0].id, "accounting.accrual.created", null, "active", { recognitionCount: dates.length });
  return result.rows[0];
}

export async function listAccrualSchedules(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND schedule.company_id=$${values.length}`;
  }
  if (filters.status && filters.status !== "all") {
    values.push(text(filters.status, 30));
    where += ` AND schedule.status=${values.length}`;
  }
  // Only the three real schedule types can be asked for; anything else is ignored rather than passed to SQL.
  if (["accrual", "deferred_expense", "deferred_revenue"].includes(filters.scheduleType)) {
    values.push(filters.scheduleType);
    where += ` AND schedule.schedule_type=${values.length}`;
  }
  const result = await client.query(
    `SELECT schedule.*,company.name AS company_name,source_account.code AS source_account_code,
      target_account.code AS target_account_code,
      count(recognition.id)::int AS recognition_count,
      count(recognition.id) FILTER (WHERE recognition.status='posted')::int AS posted_count
    FROM tenant.accounting_accrual_schedules schedule
    JOIN public.companies company ON company.id=schedule.company_id
    JOIN tenant.accounting_accounts source_account ON source_account.id=schedule.source_account_id
    JOIN tenant.accounting_accounts target_account ON target_account.id=schedule.target_account_id
    LEFT JOIN tenant.accounting_accrual_recognitions recognition ON recognition.schedule_id=schedule.id
    WHERE schedule.organization_id=$1${where}
    GROUP BY schedule.id,company.name,source_account.code,target_account.code
    ORDER BY schedule.start_date DESC,schedule.code`,
    values,
  );
  return result.rows;
}

export async function getAccrualSchedule(client, context, scheduleIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const schedule = await loadSchedule(client, context, scheduleIdValue);
  const recognitions = await client.query(
    `SELECT recognition.*,entry.entry_number
       FROM tenant.accounting_accrual_recognitions recognition
       LEFT JOIN tenant.accounting_journal_entries entry ON entry.id=recognition.journal_entry_id
      WHERE recognition.organization_id=$1 AND recognition.schedule_id=$2
      ORDER BY recognition.recognition_date`,
    [context.organizationId, schedule.id],
  );
  return { schedule, recognitions: recognitions.rows };
}

export async function runDueAccruals(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.recurringManage);
  const runDate = isoDate(input.runDate || new Date().toISOString().slice(0, 10), "Run date");
  const values = [context.organizationId, runDate];
  let where = "";
  if (input.scheduleId) {
    values.push(uuid(input.scheduleId, "Accrual schedule"));
    where += ` AND schedule.id=$${values.length}`;
  }
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND schedule.company_id=$${values.length}`;
  }
  const due = await client.query(
    `SELECT recognition.id
       FROM tenant.accounting_accrual_recognitions recognition
       JOIN tenant.accounting_accrual_schedules schedule ON schedule.id=recognition.schedule_id
      WHERE recognition.organization_id=$1 AND recognition.status='planned'
        AND recognition.recognition_date<=$2::date AND schedule.status='active'${where}
      ORDER BY recognition.recognition_date,recognition.id FOR UPDATE OF recognition SKIP LOCKED`,
    values,
  );
  const output = [];
  for (const row of due.rows) {
    const detail = await client.query(
      `SELECT recognition.*,schedule.company_id,schedule.schedule_type,schedule.code,schedule.name,
        schedule.source_account_id,schedule.target_account_id,source_account.ledger_id,company.base_currency
       FROM tenant.accounting_accrual_recognitions recognition
       JOIN tenant.accounting_accrual_schedules schedule ON schedule.id=recognition.schedule_id
       JOIN tenant.accounting_accounts source_account ON source_account.id=schedule.source_account_id
       JOIN public.companies company ON company.id=schedule.company_id
       WHERE recognition.organization_id=$1 AND recognition.id=$2 FOR UPDATE OF recognition`,
      [context.organizationId, row.id],
    );
    const recognition = detail.rows[0];
    if (!recognition || recognition.status !== "planned") continue;
    const journal = await client.query(
      `SELECT id FROM tenant.accounting_journals
        WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='general' AND status='active'
        ORDER BY created_at LIMIT 1`,
      [context.organizationId, recognition.company_id, recognition.ledger_id],
    );
    if (!journal.rows[0]) throw new AccountingError(409, "General journal is not configured for accrual recognition.");
    const amount = recognition.amount;
    const deferredRevenue = recognition.schedule_type === "deferred_revenue";
    const journalEntry = await createJournalEntry(client, context, {
      companyId: recognition.company_id,
      ledgerId: recognition.ledger_id,
      journalId: journal.rows[0].id,
      entryDate: recognition.recognition_date,
      accountingDate: recognition.recognition_date,
      entryType: "accrual",
      reference: recognition.code,
      description: `${recognition.name} · ${recognition.recognition_date}`,
      currencyCode: recognition.base_currency,
      lines: deferredRevenue
        ? [
            { accountId: recognition.source_account_id, debit: amount, credit: 0, referenceType: "accrual_schedule", referenceId: recognition.schedule_id },
            { accountId: recognition.target_account_id, debit: 0, credit: amount, referenceType: "accrual_schedule", referenceId: recognition.schedule_id },
          ]
        : [
            { accountId: recognition.target_account_id, debit: amount, credit: 0, referenceType: "accrual_schedule", referenceId: recognition.schedule_id },
            { accountId: recognition.source_account_id, debit: 0, credit: amount, referenceType: "accrual_schedule", referenceId: recognition.schedule_id },
          ],
    }, { internal: true, sourceModule: "accounting", sourceType: "accrual_schedule", sourceId: recognition.schedule_id, sourceNumber: recognition.code });
    await postJournalEntry(client, context, journalEntry.entry.id, { internal: true, allowDraft: true });
    await client.query(
      `UPDATE tenant.accounting_accrual_recognitions SET status='posted',journal_entry_id=$3,posted_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, recognition.id, journalEntry.entry.id],
    );
    const schedule = await client.query(
      `UPDATE tenant.accounting_accrual_schedules SET recognized_amount=recognized_amount+$3,updated_by=$4,
        status=CASE WHEN recognized_amount+$3>=total_amount THEN 'completed' ELSE status END
        WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [context.organizationId, recognition.schedule_id, recognition.amount, context.userId],
    );
    await event(client, context, "accrual_schedule", recognition.schedule_id, "accounting.accrual.recognized", "active", schedule.rows[0].status, { recognitionId: recognition.id, journalEntryId: journalEntry.entry.id });
    output.push({ recognitionId: recognition.id, journalEntryId: journalEntry.entry.id, status: "posted" });
  }
  return output;
}
