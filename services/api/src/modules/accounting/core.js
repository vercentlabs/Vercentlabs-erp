import { createHash } from "node:crypto";
import { ACCOUNTING_PERMISSIONS } from "@vercentlabs/permissions";
import { decimal, asDatabaseDecimal, mul, roundMoney } from "./money.js";

export class AccountingError extends Error {
  constructor(status, message, code = "ACCOUNTING_ERROR") {
    super(message);
    this.name = "AccountingError";
    this.status = status;
    this.code = code;
  }
}

export function hasPermission(context, permission) {
  return context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission);
}
export function requirePermission(context, permission) {
  if (!hasPermission(context, permission)) throw new AccountingError(403, "You do not have permission to perform this accounting action.");
}
export { ACCOUNTING_PERMISSIONS };

export function uuid(value, label = "Record") {
  const result = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new AccountingError(400, `${label} is invalid.`);
  }
  return result;
}
export function optionalUuid(value, label) { return value ? uuid(value, label) : null; }
export function text(value, limit = 500) { return String(value ?? "").trim().slice(0, limit); }
export function strictBoolean(value, label, options = {}) {
  if (value === undefined || value === null || value === "") {
    if ("defaultValue" in options) return Boolean(options.defaultValue);
    throw new AccountingError(400, `${label} must be true or false.`);
  }
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  if (value === 1) return true;
  if (value === 0) return false;
  throw new AccountingError(400, `${label} must be true or false.`);
}

export function requiredText(value, label, limit = 500) {
  const result = text(value, limit);
  if (!result) throw new AccountingError(400, `${label} is required.`);
  return result;
}
export function isoDate(value, label = "Date") {
  // node-postgres returns DATE/TIMESTAMP columns as real JS Date objects,
  // not strings -- String(new Date(...)) produces something like "Sun Dec
  // 06 2026 ...", which fails the regex below. Every caller here re-feeds
  // values it just read back from a real database row (e.g. postVendorBill
  // passing bill.accounting_date into createJournalEntry) as well as raw
  // client input, so both shapes must be accepted. Found via a real
  // browser E2E run against a live Postgres database -- this repo's
  // existing test suite never caught it because every other test uses a
  // fake DB client that only ever returns the string it was told to.
  const result = (value instanceof Date ? value.toISOString() : String(value || "")).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new AccountingError(400, `${label} is invalid.`);
  }
  return result;
}
export function today() { return new Date().toISOString().slice(0, 10); }
export function currency(value) {
  const result = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) throw new AccountingError(400, "Currency is invalid.");
  return result;
}
export function positiveAmount(value, label = "Amount") {
  const amount = decimal(value);
  if (amount <= 0n) throw new AccountingError(400, `${label} must be greater than zero.`);
  return amount;
}
export function nonNegativeAmount(value, label = "Amount") {
  const amount = decimal(value);
  if (amount < 0n) throw new AccountingError(400, `${label} cannot be negative.`);
  return amount;
}
export function hashPayload(value) {
  const stable = (input) => {
    // Every journal line normalizeLines() produces (journals.js) carries
    // several BigInt fields (debit, credit, baseDebit, baseCredit,
    // taxBaseAmount, dimension allocationPercent) -- JSON.stringify()
    // throws on ANY BigInt, including 0n, so every real journal entry
    // (vendor bill, customer invoice, manual journal, payment...) crashed
    // computing its own contentHash. No existing test caught this because
    // every one of them uses a fake DB client that only ever hands back
    // the decimal *strings* it was told to, never a real decimal()-derived
    // BigInt -- a real browser E2E run against a live Postgres database
    // was what finally exercised this path for real.
    if (typeof input === "bigint") return input.toString();
    if (Array.isArray(input)) return `[${input.map(stable).join(",")}]`;
    if (input && typeof input === "object") return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stable(input[key])}`).join(",")}}`;
    return JSON.stringify(input);
  };
  return createHash("sha256").update(stable(value)).digest("hex");
}

export async function allocateNumber(client, organizationId, entityType) {
  const result = await client.query(
    `UPDATE public.numbering_series
        SET next_number=next_number+1,updated_at=now()
      WHERE organization_id=$1 AND entity_type=$2 AND status='active'
      RETURNING prefix,next_number-1 AS number,padding`,
    [organizationId, entityType],
  );
  const row = result.rows[0];
  if (!row) throw new AccountingError(409, `Numbering series ${entityType} is not configured.`);
  return `${row.prefix}${String(row.number).padStart(Number(row.padding || 5), "0")}`;
}

export async function loadCompany(client, context, companyIdValue) {
  const companyId = uuid(companyIdValue || context.activeCompanyId, "Company");
  const result = await client.query(
    `SELECT company.id,company.name,company.legal_name,company.base_currency,company.country_code
       FROM public.companies company
      WHERE company.organization_id=$1 AND company.id=$2`,
    [context.organizationId, companyId],
  );
  const company = result.rows[0];
  if (!company) throw new AccountingError(404, "Company was not found in this organisation.");
  if (!context.allowAllCompanies && context.activeCompanyId && context.activeCompanyId !== companyId) {
    throw new AccountingError(403, "Select this company before performing the accounting action.");
  }
  return company;
}

export async function validateBranch(client, context, companyId, branchIdValue) {
  const branchId = branchIdValue ? uuid(branchIdValue, "Branch") : null;
  if (!branchId) return null;
  const result = await client.query(
    `SELECT id,name FROM public.branches WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, companyId, branchId],
  );
  if (!result.rows[0]) throw new AccountingError(409, "The selected branch does not belong to the company.");
  return result.rows[0];
}

export async function getPrimaryLedger(client, context, companyId, ledgerIdValue = null) {
  const values = [context.organizationId, companyId];
  let where = "AND ledger.ledger_type='primary'";
  if (ledgerIdValue) { values.push(uuid(ledgerIdValue, "Ledger")); where = `AND ledger.id=$${values.length}`; }
  const result = await client.query(
    `SELECT ledger.* FROM tenant.accounting_ledgers ledger
      WHERE ledger.organization_id=$1 AND ledger.company_id=$2 ${where} AND ledger.status='active'
      ORDER BY ledger.ledger_type='primary' DESC,ledger.created_at LIMIT 1`,
    values,
  );
  if (!result.rows[0]) throw new AccountingError(409, "An active accounting ledger is not configured for the company.");
  return result.rows[0];
}

export async function getOpenPeriod(client, context, companyId, accountingDateValue) {
  const accountingDate = isoDate(accountingDateValue, "Accounting date");
  const result = await client.query(
    `SELECT * FROM tenant.fiscal_periods
      WHERE organization_id=$1 AND company_id=$2 AND $3::date BETWEEN start_date AND end_date
      ORDER BY period_type='standard' DESC,start_date DESC LIMIT 1`,
    [context.organizationId, companyId, accountingDate],
  );
  const period = result.rows[0];
  if (!period) throw new AccountingError(409, "No fiscal period covers the accounting date.");
  if (period.status !== "open") throw new AccountingError(409, `Fiscal period ${period.name} is ${period.status}.`);
  return period;
}

export async function getCurrencyPrecision(client, context, currencyCode) {
  const result = await client.query(
    `SELECT decimal_places FROM tenant.currencies WHERE organization_id=$1 AND code=$2 AND status='active'`,
    [context.organizationId, currency(currencyCode)],
  );
  return Number(result.rows[0]?.decimal_places ?? 2);
}

export async function getExchangeRate(client, context, companyId, fromCurrency, toCurrency, rateDate, suppliedRate = null) {
  const from = currency(fromCurrency);
  const to = currency(toCurrency);
  if (from === to) return decimal(1);
  if (suppliedRate !== null && suppliedRate !== undefined && String(suppliedRate).trim() !== "") return positiveAmount(suppliedRate, "Exchange rate");
  const result = await client.query(
    `SELECT rate FROM tenant.exchange_rates
      WHERE organization_id=$1 AND (company_id=$2 OR company_id IS NULL)
        AND from_currency_code=$3 AND to_currency_code=$4 AND rate_date<=$5::date AND status='active'
      ORDER BY company_id IS NOT NULL DESC,rate_date DESC LIMIT 1`,
    [context.organizationId, companyId, from, to, isoDate(rateDate)],
  );
  if (!result.rows[0]) throw new AccountingError(409, `No exchange rate exists from ${from} to ${to} on the accounting date.`);
  return positiveAmount(result.rows[0].rate, "Exchange rate");
}

export async function getAccountMapping(client, context, companyId, ledgerId, mappingKey, selectors = {}) {
  const result = await client.query(
    `SELECT mapping.account_id,account.code,account.name,account.account_type,account.account_class
       FROM tenant.accounting_account_mappings mapping
       JOIN tenant.accounting_accounts account ON account.id=mapping.account_id
      WHERE mapping.organization_id=$1 AND mapping.company_id=$2 AND mapping.ledger_id=$3
        AND mapping.mapping_key=$4 AND mapping.status='active'
        AND (mapping.branch_id IS NULL OR mapping.branch_id=$5)
        AND (mapping.party_id IS NULL OR mapping.party_id=$6)
        AND (mapping.item_id IS NULL OR mapping.item_id=$7)
        AND (mapping.item_group_id IS NULL OR mapping.item_group_id=$8)
        AND (mapping.tax_category_id IS NULL OR mapping.tax_category_id=$9)
        AND (mapping.effective_from IS NULL OR mapping.effective_from<=$10::date)
        AND (mapping.effective_to IS NULL OR mapping.effective_to>=$10::date)
      ORDER BY
        (mapping.item_id IS NOT NULL)::int DESC,
        (mapping.party_id IS NOT NULL)::int DESC,
        (mapping.item_group_id IS NOT NULL)::int DESC,
        (mapping.tax_category_id IS NOT NULL)::int DESC,
        (mapping.branch_id IS NOT NULL)::int DESC,
        mapping.priority ASC
      LIMIT 1`,
    [context.organizationId, companyId, ledgerId, mappingKey, selectors.branchId || null, selectors.partyId || null,
      selectors.itemId || null, selectors.itemGroupId || null, selectors.taxCategoryId || null, selectors.date || today()],
  );
  if (!result.rows[0]) throw new AccountingError(409, `Account mapping ${mappingKey} is not configured.`);
  return result.rows[0];
}

export async function ensureParty(client, context, companyId, partyIdValue, allowedTypes) {
  const partyId = uuid(partyIdValue, "Party");
  const result = await client.query(
    `SELECT * FROM tenant.business_parties
      WHERE organization_id=$1 AND id=$2 AND status='active' AND (company_id IS NULL OR company_id=$3)`,
    [context.organizationId, partyId, companyId],
  );
  const party = result.rows[0];
  if (!party) throw new AccountingError(404, "The party is inactive or unavailable for this company.");
  if (allowedTypes && !allowedTypes.includes(party.party_type)) throw new AccountingError(409, `Party type ${party.party_type} is not valid for this transaction.`);
  return party;
}

export async function event(client, context, entityType, entityId, eventType, fromStatus, toStatus, metadata = {}) {
  await client.query(
    `INSERT INTO tenant.accounting_events
      (organization_id,entity_type,entity_id,event_type,from_status,to_status,metadata,actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [context.organizationId, entityType, entityId, eventType, fromStatus || null, toStatus || null, JSON.stringify(metadata), context.userId || null],
  );
}

export function toBaseAmount(amount, exchangeRate, precision = 2) {
  return roundMoney(mul(amount, exchangeRate), precision);
}
export { decimal, asDatabaseDecimal, mul, roundMoney };
