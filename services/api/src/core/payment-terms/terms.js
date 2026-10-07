// What a payment term means, and the one place due dates and payment schedules are worked out — for Sales, Procurement and Finance.
//
// A term is a set of rules, each a share of the document (100% for a single due date; several for instalments):
//   reference date   the invoice date, the date the invoice was received, or the posting date
//   kind             days          the reference date + N calendar days (Net N; 0 = immediate)
//                    end_of_month  the last day of the reference month (+ M months) + N days (EOM + 15)
//                    fixed_day     day D of the reference month (+ M months) — clamped to the month's last day (31st in February: the 28th/29th)
// Term types name the common shapes: immediate, net_days, invoice_receipt (Net N from the invoice received date), end_of_month,
// fixed_day, installments (several rules), advance (an advance the purchase order expects, the bill payable on the rules), and
// custom (a condition in words: no due date can be worked out, so the document's due date is entered).
// Calendar days, no business-day rules. A term never pays anything, discounts or charges interest.
//
// A document keeps the term it was agreed with as a snapshot. Everything here works from that snapshot, never from today's master, so
// changing or deactivating a term later moves no quotation, order, invoice or bill.
import { decimal, div, mul, roundMoney, sub } from "../decimal.js";

export const CALCULATION = Object.freeze({ dueOnReceipt: "due_on_receipt", netDays: "net_days", custom: "custom" });
export const CALCULATION_TYPES = Object.freeze([
  { code: CALCULATION.dueOnReceipt, label: "Due on receipt" },
  { code: CALCULATION.netDays, label: "Net days" },
  { code: CALCULATION.custom, label: "Custom (described in words)" },
]);
export const calculationLabel = (code) => CALCULATION_TYPES.find((entry) => entry.code === code)?.label ?? code;

export const TERM_TYPES = Object.freeze([
  { code: "immediate", label: "Immediate" }, { code: "net_days", label: "Net days" }, { code: "invoice_receipt", label: "Days after invoice received" },
  { code: "end_of_month", label: "End of month + days" }, { code: "fixed_day", label: "Fixed day of a month" }, { code: "installments", label: "Instalments" },
  { code: "advance", label: "Advance / deposit" }, { code: "custom", label: "Custom (described in words)" },
]);
export const termTypeLabel = (code) => TERM_TYPES.find((entry) => entry.code === code)?.label ?? code;
export const REFERENCE_BASES = Object.freeze([
  { code: "invoice_date", label: "Supplier invoice date" }, { code: "invoice_received", label: "Invoice received date" }, { code: "posting_date", label: "Posting date" },
]);
export const RULE_KINDS = Object.freeze([
  { code: "days", label: "Days after" }, { code: "end_of_month", label: "End of month + days" }, { code: "fixed_day", label: "Fixed day of month" },
]);
// A sanity limit on days: ten years.
export const MAX_NET_DAYS = 3650;

export class PaymentTermRuleError extends Error {
  constructor(message, code = "PAYMENT_TERM_RULES_INVALID", field = "rules") {
    super(message);
    this.name = "PaymentTermRuleError";
    this.status = 400;
    this.code = code;
    this.details = { field };
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const dayOf = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : String(value ?? "").slice(0, 10));
const toDate = (day) => new Date(`${day}T00:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);
export function addDays(day, days) { const date = toDate(day); date.setUTCDate(date.getUTCDate() + Number(days || 0)); return iso(date); }
const lastDayOf = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

// ---------------------------------------------------------------- rules

const integer = (value, fallback = 0) => (value === undefined || value === null || value === "" ? fallback : Number(value));

// A rule as kept in a snapshot.
export function normalizeRule(rule, index = 0) {
  const kind = ["days", "end_of_month", "fixed_day"].includes(rule.kind ?? rule.rule_kind) ? (rule.kind ?? rule.rule_kind) : "days";
  return {
    sequence: integer(rule.sequence, index + 1), percentage: String(rule.percentage ?? "100"),
    basis: ["invoice_date", "invoice_received", "posting_date"].includes(rule.basis ?? rule.reference_basis) ? (rule.basis ?? rule.reference_basis) : "invoice_date",
    kind, days: integer(rule.days ?? rule.dueDays ?? rule.due_days, 0), monthsOffset: integer(rule.monthsOffset ?? rule.months_offset, 0),
    dayOfMonth: rule.dayOfMonth ?? rule.day_of_month ?? null,
  };
}

// validatePaymentTermRules: every rule possible, positive shares totalling exactly 100%. Throws PaymentTermRuleError.
export function validatePaymentTermRules(rules) {
  if (!Array.isArray(rules) || !rules.length) throw new PaymentTermRuleError("Add at least one payment rule.");
  if (rules.length > 12) throw new PaymentTermRuleError("A payment term has at most 12 instalments.");
  let total = 0n;
  const out = rules.map((raw, index) => {
    const rule = normalizeRule(raw, index);
    const label = rules.length > 1 ? `Instalment ${index + 1}` : "The rule";
    const percentage = decimal(rule.percentage);
    if (!/^\d+(\.\d{1,4})?$/.test(String(rule.percentage).trim()) || percentage <= 0n) throw new PaymentTermRuleError(`${label}: the share must be a positive percentage.`, "PAYMENT_TERM_PERCENTAGE_INVALID", `rules.${index}.percentage`);
    if (!Number.isInteger(rule.days) || rule.days < 0 || rule.days > MAX_NET_DAYS) throw new PaymentTermRuleError(`${label}: days must be a whole number from 0 to ${MAX_NET_DAYS}.`, "PAYMENT_TERM_DAYS_INVALID", `rules.${index}.days`);
    if (!Number.isInteger(rule.monthsOffset) || rule.monthsOffset < 0 || rule.monthsOffset > 12) throw new PaymentTermRuleError(`${label}: months must be 0 to 12.`, "PAYMENT_TERM_RULES_INVALID", `rules.${index}.monthsOffset`);
    if (rule.kind === "fixed_day") {
      const day = Number(rule.dayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new PaymentTermRuleError(`${label}: the day of the month must be 1 to 31.`, "PAYMENT_TERM_RULES_INVALID", `rules.${index}.dayOfMonth`);
      if (rule.days) throw new PaymentTermRuleError(`${label}: a fixed day takes no extra days.`, "PAYMENT_TERM_RULES_INVALID", `rules.${index}.days`);
      rule.dayOfMonth = day;
    } else rule.dayOfMonth = null;
    if (rule.kind === "days" && rule.monthsOffset) throw new PaymentTermRuleError(`${label}: "days after" takes no month offset.`, "PAYMENT_TERM_RULES_INVALID", `rules.${index}.monthsOffset`);
    total += percentage;
    return { ...rule, sequence: index + 1 };
  });
  if (total !== decimal(100)) throw new PaymentTermRuleError(`The shares total ${Number(total) / 1e6}%: they must total exactly 100%.`, "PAYMENT_TERM_PERCENTAGE_TOTAL");
  return out;
}
export const validateInstallmentPercentages = (rules) => validatePaymentTermRules(rules);

// The due date of one rule from the document's dates ({ invoiceDate, invoiceReceivedDate, postingDate }). Returns { dueDate, referenceDate,
// basis, missing } — missing when the rule counts from a date not recorded yet (the due date is then null).
export function dueDateForRule(raw, dates = {}) {
  const rule = normalizeRule(raw);
  const reference = { invoice_date: dates.invoiceDate, invoice_received: dates.invoiceReceivedDate, posting_date: dates.postingDate ?? dates.invoiceDate }[rule.basis];
  const referenceDate = reference ? dayOf(reference) : null;
  if (!referenceDate || !DAY.test(referenceDate)) return { dueDate: null, referenceDate: null, basis: rule.basis, missing: true };
  const base = toDate(referenceDate);
  let dueDate;
  if (rule.kind === "days") dueDate = addDays(referenceDate, rule.days);
  else {
    const monthIndex = base.getUTCMonth() + rule.monthsOffset;
    const year = base.getUTCFullYear() + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    const last = lastDayOf(year, month);
    const day = rule.kind === "end_of_month" ? last : Math.min(Number(rule.dayOfMonth), last);
    dueDate = iso(new Date(Date.UTC(year, month, day)));
    if (rule.kind === "end_of_month") dueDate = addDays(dueDate, rule.days);
  }
  return { dueDate, referenceDate, basis: rule.basis, missing: false };
}

// ---------------------------------------------------------------- snapshots

const legacyRules = (calculationType, days) => [{ sequence: 1, percentage: "100", basis: "invoice_date", kind: "days", days: calculationType === CALCULATION.netDays ? Number(days ?? 0) : 0,
  monthsOffset: 0, dayOfMonth: null }];

// The snapshot a document keeps of a master row (tenant.payment_terms) and its rules (tenant.payment_term_lines rows), with the document's own text.
export function snapshotOfTerm(term, rules = null, note = null) {
  if (!term) return {};
  const calculationType = term.calculation_type ?? (Number(term.default_due_days) > 0 ? CALCULATION.netDays : CALCULATION.dueOnReceipt);
  const days = calculationType === CALCULATION.netDays ? Number(term.default_due_days ?? 0) : calculationType === CALCULATION.dueOnReceipt ? 0 : null;
  const termType = term.term_type ?? (calculationType === CALCULATION.custom ? "custom" : calculationType === CALCULATION.dueOnReceipt ? "immediate" : "net_days");
  const ruleRows = Array.isArray(rules) && rules.length ? rules.map((row, index) => normalizeRule(row, index)) : calculationType === CALCULATION.custom ? [] : legacyRules(calculationType, days);
  return {
    id: term.id, code: term.code, name: term.name, description: term.description ?? null, calculationType, termType, days, version: Number(term.version ?? 1),
    rules: ruleRows, advancePercentage: term.advance_percentage === null || term.advance_percentage === undefined ? null : String(Number(term.advance_percentage)),
    // Read by documents written before the calculation type was kept.
    default_due_days: days ?? 0,
    ...(note ? { note } : {}),
  };
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th"}`;
// A plain description of a rule set: "Net 30 from the invoice date", "50% immediate · 50% Net 30", "EOM + 15".
export function describeRules(rules) {
  const one = (rule) => {
    const from = { invoice_date: "the invoice date", invoice_received: "the invoice received date", posting_date: "the posting date" }[rule.basis];
    if (rule.kind === "end_of_month") return `end of ${rule.monthsOffset ? `month + ${rule.monthsOffset}` : "the month"}${rule.days ? ` + ${rule.days} days` : ""} (from ${from})`;
    if (rule.kind === "fixed_day") return `the ${ordinal(rule.dayOfMonth)} of ${rule.monthsOffset === 0 ? "the same month" : rule.monthsOffset === 1 ? "the following month" : `month + ${rule.monthsOffset}`} (from ${from})`;
    return rule.days ? `${rule.days} day${rule.days === 1 ? "" : "s"} from ${from}` : `on ${from}`;
  };
  if (!rules?.length) return "Due date entered on each document";
  if (rules.length === 1) return `Due ${one(rules[0])}`;
  return rules.map((rule) => `${Number(rule.percentage)}% ${one(rule)}`).join(" · ");
}

// A stored snapshot in today's shape. Snapshots written before rules were kept carry only default_due_days (or days).
export function readTermSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || (!snapshot.id && !snapshot.name)) return null;
  const legacyDays = Number(snapshot.default_due_days ?? snapshot.defaultDueDays ?? 0) || 0;
  const calculationType = Object.values(CALCULATION).includes(snapshot.calculationType) ? snapshot.calculationType : legacyDays > 0 ? CALCULATION.netDays : CALCULATION.dueOnReceipt;
  const days = calculationType === CALCULATION.netDays ? Number(snapshot.days ?? legacyDays) || 0 : calculationType === CALCULATION.dueOnReceipt ? 0 : null;
  const rules = Array.isArray(snapshot.rules) && snapshot.rules.length ? snapshot.rules.map((rule, index) => normalizeRule(rule, index))
    : Array.isArray(snapshot.lines) && snapshot.lines.length ? snapshot.lines.map((line, index) => normalizeRule({ ...line, days: line.dueDays ?? line.due_days }, index))
      : calculationType === CALCULATION.custom ? [] : legacyRules(calculationType, days);
  const termType = snapshot.termType ?? (calculationType === CALCULATION.custom ? "custom" : rules.length > 1 ? "installments" : calculationType === CALCULATION.dueOnReceipt ? "immediate" : "net_days");
  return {
    id: snapshot.id ?? null, code: snapshot.code ?? null, name: snapshot.name ?? null, description: snapshot.description ?? null, calculationType, termType, days,
    version: Number(snapshot.version ?? 1), rules, advancePercentage: snapshot.advancePercentage ?? null, note: snapshot.note ?? null,
    calculationLabel: calculationLabel(calculationType), termTypeLabel: termTypeLabel(termType), summary: describeRules(rules),
    needsInvoiceReceivedDate: rules.some((rule) => rule.basis === "invoice_received"),
  };
}

// calculatePaymentDueDate / generatePaymentSchedule: the instalments of `total` (a decimal) under the terms in `snapshot`, from the
// document's dates. Each instalment: { sequence, percentage, amount (decimal, currency-rounded; the last takes the rounding so the
// instalments total exactly), dueDate, referenceDate, basis, missing, rule }. Returns null for terms that set no date (custom, none).
export function generatePaymentSchedule(snapshot, { total, precision = 2, dates = {} } = {}) {
  const term = readTermSnapshot(snapshot);
  if (!term || !term.rules.length) return null;
  const amount = roundMoney(decimal(total ?? 0), precision);
  let allocated = 0n;
  return term.rules.map((rule, index) => {
    const share = index === term.rules.length - 1 ? sub(amount, allocated) : roundMoney(mul(amount, div(decimal(rule.percentage), decimal(100))), precision);
    allocated += share;
    const due = dueDateForRule(rule, dates);
    return { sequence: index + 1, percentage: rule.percentage, amount: share, dueDate: due.dueDate, referenceDate: due.referenceDate, basis: due.basis, missing: due.missing, rule };
  });
}
export const calculateInstallmentAmounts = (snapshot, total, precision = 2) => generatePaymentSchedule(snapshot, { total, precision, dates: { invoiceDate: "2000-01-01" } })
  ?.map((line) => ({ sequence: line.sequence, percentage: line.percentage, amount: line.amount })) ?? null;

// The due date of a document dated `documentDate` (the last instalment's), or null when the terms set no date. `dates` adds the other
// reference dates (invoice received, posting); a rule counting from a date not recorded yet counts from the document date here.
export function calculateDueDate(documentDate, snapshot, dates = {}) {
  const day = dayOf(documentDate);
  if (!DAY.test(day)) return null;
  const schedule = generatePaymentSchedule(snapshot, { total: "100", dates: { invoiceDate: day, ...dates } });
  if (!schedule) return null;
  return schedule.map((line) => line.dueDate ?? dueDateForRule({ ...line.rule, basis: "invoice_date" }, { invoiceDate: day }).dueDate).sort().at(-1);
}
export const calculatePaymentDueDate = calculateDueDate;

// The customer's own terms, else the company's default for Sales. Returns the term id or null.
export async function resolveDefaultPaymentTerm(client, organizationId, { partyId = null } = {}) {
  const row = (await client.query(
    `SELECT (SELECT party.payment_term_id FROM tenant.business_parties party WHERE party.organization_id = $1 AND party.id = $2) AS customer_term,
            (SELECT settings.default_payment_term_id FROM tenant.sales_settings settings WHERE settings.organization_id = $1) AS company_term`, [organizationId, partyId])).rows[0];
  return { paymentTermId: row.customer_term ?? row.company_term ?? null, source: row.customer_term ? "customer" : row.company_term ? "company" : null };
}

// The company's local calendar date (its timezone): what "due today" and "overdue" are measured against.
export async function companyToday(client, organizationId) {
  return (await client.query(`SELECT (now() AT TIME ZONE COALESCE(NULLIF(timezone, ''), 'UTC'))::date::text AS day FROM public.organizations WHERE id = $1`, [organizationId])).rows[0]?.day
    ?? (await client.query(`SELECT current_date::text AS day`)).rows[0].day;
}
