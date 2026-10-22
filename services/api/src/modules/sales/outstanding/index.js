// Collections inside Sales (Sales plan, Flow 4): what was said to a customer that owes — a reminder sent, a promise to pay by a date, a
// note — and its statement of account as a PDF. The ledger itself is Finance's (customers/ledger.js reads it), so the statement agrees
// with Accounting's.
import { canViewCustomerFinancials, requireCustomerPermission } from "../customers/access.js";
import { CUSTOMER_PERMISSIONS, CustomerError } from "../customers/constants.js";
import { getCustomerLedger } from "../customers/ledger.js";
import { loadCustomerRow } from "../customers/records.js";
import { companyToday } from "../today.js";

const KINDS = Object.freeze(["reminder", "promise", "note"]);
const CHANNELS = Object.freeze(["whatsapp", "email", "call", "visit"]);
const text = (value, max) => String(value ?? "").trim().slice(0, max);

function requireFinancials(context) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.view, "You do not have permission to view customers.");
  if (!canViewCustomerFinancials(context)) throw new CustomerError(403, "You do not have permission to see customer balances.", "PERMISSION_DENIED");
}

const noteView = (row) => ({
  id: row.id, kind: row.kind, channel: row.channel, promisedDate: row.promised_day ?? null,
  promisedAmount: row.promised_amount == null ? null : Number(row.promised_amount), amountDue: row.amount_due == null ? null : Number(row.amount_due), note: row.note,
  createdAt: row.created_at, createdBy: row.created_by_name ?? null,
});

export async function listCollectionNotes(client, context, partyId) {
  requireFinancials(context);
  const customer = await loadCustomerRow(client, context, partyId);
  const rows = (await client.query(
    `SELECT note.*, note.promised_date::text AS promised_day, app_user.full_name AS created_by_name FROM tenant.sales_collection_notes note LEFT JOIN public.users app_user ON app_user.id = note.created_by
      WHERE note.organization_id = $1 AND note.party_id = $2 ORDER BY note.created_at DESC LIMIT 100`, [context.organizationId, customer.id])).rows;
  return { notes: rows.map(noteView) };
}

// input: { kind: 'promise' | 'note' | 'reminder', channel?, promisedDate? (a promise needs it, not before today), promisedAmount?, note? }
export async function addCollectionNote(client, context, partyId, input = {}) {
  requireFinancials(context);
  const customer = await loadCustomerRow(client, context, partyId);
  const kind = KINDS.includes(input.kind) ? input.kind : "note";
  const channel = CHANNELS.includes(input.channel) ? input.channel : null;
  const note = text(input.note, 1000) || null;
  let promisedDate = null;
  let promisedAmount = null;
  if (kind === "promise") {
    promisedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.promisedDate ?? "")) ? String(input.promisedDate) : null;
    if (!promisedDate) throw new CustomerError(400, "Enter the date the customer promised to pay by.", "SALES_COLLECTION_INVALID", { field: "promisedDate" });
    if (promisedDate < await companyToday(client)) throw new CustomerError(400, "A promise to pay is for today or later.", "SALES_COLLECTION_INVALID", { field: "promisedDate" });
    if (input.promisedAmount != null && input.promisedAmount !== "") {
      promisedAmount = Math.round(Number(input.promisedAmount) * 100) / 100;
      if (!(promisedAmount > 0)) throw new CustomerError(400, "Enter the amount promised, or leave it empty.", "SALES_COLLECTION_INVALID", { field: "promisedAmount" });
    }
  } else if (!note) throw new CustomerError(400, "Write the note.", "SALES_COLLECTION_INVALID", { field: "note" });
  const row = (await client.query(
    `INSERT INTO tenant.sales_collection_notes (organization_id, party_id, kind, channel, promised_date, promised_amount, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *, promised_date::text AS promised_day`,
    [context.organizationId, customer.id, kind, channel, promisedDate, promisedAmount, note, context.userId ?? null])).rows[0];
  return { note: noteView(row) };
}

// For each customer, the latest promise to pay still to come or just missed (within 30 days) and when it was last reminded.
export async function collectionStateOf(client, organizationId, partyIds) {
  if (!partyIds.length) return new Map();
  const rows = (await client.query(
    `SELECT party_id,
            (array_agg(promised_date::text ORDER BY created_at DESC) FILTER (WHERE kind = 'promise' AND promised_date >= tenant.company_today() - 30))[1] AS promised_date,
            (array_agg(promised_amount ORDER BY created_at DESC) FILTER (WHERE kind = 'promise' AND promised_date >= tenant.company_today() - 30))[1] AS promised_amount,
            max(created_at) FILTER (WHERE kind = 'reminder') AS last_reminder_at
       FROM tenant.sales_collection_notes WHERE organization_id = $1 AND party_id = ANY($2::uuid[]) GROUP BY party_id`, [organizationId, partyIds])).rows;
  return new Map(rows.map((row) => [row.party_id, {
    promisedDate: row.promised_date ?? null,
    promisedAmount: row.promised_amount == null ? null : Number(row.promised_amount), lastReminderAt: row.last_reminder_at ?? null,
  }]));
}

// The statement of account to print (Outstanding › Statements, the customer's Ledger tab): the ledger between two dates and what is
// open by age. options: { from?, to? }
export async function getCustomerStatementDocument(client, context, partyId, options = {}) {
  requireFinancials(context);
  const statement = await getCustomerLedger(client, context, partyId, { from: options.from, to: options.to });
  return { statement };
}
