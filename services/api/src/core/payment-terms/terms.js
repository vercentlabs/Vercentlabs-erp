// What a payment term means, and the one place a due date is worked out.
//
// A term is one of three kinds:
//   due_on_receipt  due date = the invoice date
//   net_days        due date = the invoice date + N calendar days
//   custom          a commercial condition in words ("50% advance, balance
//                   before dispatch"): no due date can be worked out, so the
//                   invoice's due date is entered by hand
// A term never says how or where to pay, whether something is paid, a
// discount for paying early or a penalty for paying late.
//
// A document keeps the term it was agreed with as a snapshot. Everything
// here works from that snapshot, never from today's master, so changing or
// deactivating a term later does not move a quotation, an order or an invoice.

export const CALCULATION = Object.freeze({ dueOnReceipt: "due_on_receipt", netDays: "net_days", custom: "custom" });
export const CALCULATION_TYPES = Object.freeze([
  { code: CALCULATION.dueOnReceipt, label: "Due on receipt" },
  { code: CALCULATION.netDays, label: "Net days" },
  { code: CALCULATION.custom, label: "Custom (described in words)" },
]);
export const calculationLabel = (code) => CALCULATION_TYPES.find((entry) => entry.code === code)?.label ?? code;
// A sanity limit on Net days: ten years.
export const MAX_NET_DAYS = 3650;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : String(value ?? "").slice(0, 10));

// The snapshot a document keeps of a master row (tenant.payment_terms), with the document's own additional text.
export function snapshotOfTerm(term, note = null) {
  if (!term) return {};
  const calculationType = term.calculation_type ?? (Number(term.default_due_days) > 0 ? CALCULATION.netDays : CALCULATION.dueOnReceipt);
  const days = calculationType === CALCULATION.netDays ? Number(term.default_due_days ?? 0) : calculationType === CALCULATION.dueOnReceipt ? 0 : null;
  return {
    id: term.id, code: term.code, name: term.name, description: term.description ?? null, calculationType, days,
    // Read by documents written before the calculation type was kept.
    default_due_days: days ?? 0,
    ...(note ? { note } : {}),
  };
}

// A stored snapshot in today's shape. Snapshots written before the calculation type was kept carry only default_due_days.
export function readTermSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || (!snapshot.id && !snapshot.name)) return null;
  const legacyDays = Number(snapshot.default_due_days ?? snapshot.defaultDueDays ?? 0) || 0;
  const calculationType = Object.values(CALCULATION).includes(snapshot.calculationType) ? snapshot.calculationType : legacyDays > 0 ? CALCULATION.netDays : CALCULATION.dueOnReceipt;
  const days = calculationType === CALCULATION.netDays ? Number(snapshot.days ?? legacyDays) || 0 : calculationType === CALCULATION.dueOnReceipt ? 0 : null;
  return {
    id: snapshot.id ?? null, code: snapshot.code ?? null, name: snapshot.name ?? null, description: snapshot.description ?? null, calculationType, days,
    note: snapshot.note ?? null, calculationLabel: calculationLabel(calculationType),
    // "Net 30 · 30 days from the invoice date", for screens.
    summary: calculationType === CALCULATION.netDays ? `${days} day${days === 1 ? "" : "s"} from the invoice date` : calculationType === CALCULATION.dueOnReceipt ? "Due on the invoice date" : "Due date entered on each invoice",
  };
}

// The due date for a document dated `documentDate` under the terms in `snapshot`; null when the terms set no date (custom, or none).
// Calendar days: no business-day or holiday rules.
export function calculateDueDate(documentDate, snapshot) {
  const day = dayOf(documentDate);
  if (!DAY.test(day)) return null;
  const term = readTermSnapshot(snapshot);
  if (!term || term.calculationType === CALCULATION.custom) return null;
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (term.days ?? 0));
  return date.toISOString().slice(0, 10);
}

// The customer's own terms, else the company's default for Sales. Returns the term id or null.
export async function resolveDefaultPaymentTerm(client, organizationId, { partyId = null } = {}) {
  const row = (await client.query(
    `SELECT (SELECT party.payment_term_id FROM tenant.business_parties party WHERE party.organization_id = $1 AND party.id = $2) AS customer_term,
            (SELECT settings.default_payment_term_id FROM tenant.sales_settings settings WHERE settings.organization_id = $1) AS company_term`, [organizationId, partyId])).rows[0];
  return { paymentTermId: row.customer_term ?? row.company_term ?? null, source: row.customer_term ? "customer" : row.company_term ? "company" : null };
}
