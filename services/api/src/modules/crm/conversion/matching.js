// Existing records that look like the lead: accounts (company name, legal
// name, website domain, GSTIN, phone, city), contacts (email, mobile, phone,
// name at the account) and open opportunities on the account. Every search
// runs in the caller's organization. A strong match the caller cannot open is
// still reported, without its details, so a duplicate is never created
// behind their back.
import { findDuplicateAccounts } from "../accounts/duplicates.js";
import { findDuplicateContacts } from "../contacts/duplicates.js";
import { ACCOUNT_COMPARE_FIELDS, CONTACT_CONFLICT_FIELDS } from "./constants.js";

const text = (value) => String(value ?? "").trim();
const same = (left, right) => text(left).toLowerCase() === text(right).toLowerCase();

export async function accountMatches(client, context, probe) {
  const { matches } = await findDuplicateAccounts(client, context, probe);
  return matches
    .filter((match) => match.canOpen || match.strength === "exact")
    .map((match) => (match.canOpen
      ? {
        id: match.id, code: match.code, name: match.name, legalName: match.legalName ?? null, website: match.website ?? null, city: match.city ?? null,
        ownerName: match.ownerName ?? null, accountType: match.accountType ?? null, isCustomer: Boolean(match.isCustomer), isArchived: Boolean(match.isArchived),
        strength: match.strength, signals: match.signals, canOpen: true,
      }
      : { id: match.id, code: null, name: "An account you do not have access to", strength: match.strength, signals: match.signals, canOpen: false }));
}

export async function contactMatches(client, context, person, accountId) {
  const { matches } = await findDuplicateContacts(client, context, {
    firstName: person.firstName, lastName: person.lastName, email: person.email, mobile: person.mobile, phone: person.phone, accountId,
  });
  return matches
    .filter((match) => match.canOpen || match.strength === "exact")
    .map((match) => (match.canOpen
      ? {
        id: match.id, code: match.code, name: match.name, jobTitle: match.jobTitle ?? null, email: match.email ?? null, mobile: match.mobile ?? null,
        accountId: match.accountId ?? null, accountName: match.accountName ?? null, ownerName: match.ownerName ?? null, isArchived: Boolean(match.isArchived),
        strength: match.strength, signals: match.signals, canOpen: true,
      }
      : { id: match.id, code: null, name: "A contact you do not have access to", strength: match.strength, signals: match.signals, canOpen: false }));
}

// Open deals on the account whose name or product looks like this one. A warning, never a block.
export async function opportunityMatches(client, context, accountIds, { name = "", productInterest = "" } = {}) {
  const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean);
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT opportunity.id, opportunity.code, opportunity.name, opportunity.amount, opportunity.currency_code, opportunity.product_interest,
            opportunity.party_id, stage.name AS stage_name, owner.full_name AS owner_name,
            (NULLIF($3, '') IS NOT NULL AND similarity(lower(opportunity.name), lower($3)) >= 0.35)
              OR (NULLIF($4, '') IS NOT NULL AND opportunity.product_interest IS NOT NULL AND similarity(lower(opportunity.product_interest), lower($4)) >= 0.35) AS similar
       FROM tenant.crm_opportunities opportunity
       LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = opportunity.organization_id AND stage.id = opportunity.stage_id
       LEFT JOIN public.users owner ON owner.id = opportunity.owner_user_id
      WHERE opportunity.organization_id = $1 AND opportunity.party_id = ANY ($2::uuid[]) AND opportunity.status = 'open' AND opportunity.archived_at IS NULL
      ORDER BY opportunity.updated_at DESC LIMIT 10`,
    [context.organizationId, ids, text(name), text(productInterest)],
  );
  return rows.map((row) => ({
    id: row.id, code: row.code, name: row.name, accountId: row.party_id, amount: Number(row.amount ?? 0), currencyCode: row.currency_code?.trim() ?? null,
    productInterest: row.product_interest, stageName: row.stage_name ?? null, ownerName: row.owner_name ?? null, similar: Boolean(row.similar),
  }));
}

// Where the lead and an existing contact disagree on a way to reach them.
export function contactConflicts(lead, contactRow) {
  return CONTACT_CONFLICT_FIELDS
    .filter((field) => text(lead[field.leadColumn]) && !same(lead[field.leadColumn], contactRow[field.contactColumn]))
    .map((field) => ({ field: field.key, label: field.label, existing: contactRow[field.contactColumn] ?? null, lead: lead[field.leadColumn] }));
}

// Where the lead and an existing account disagree. Shown only; the account is never changed.
export function accountDifferences(lead, accountRow) {
  return ACCOUNT_COMPARE_FIELDS
    .filter((field) => text(lead[field.leadColumn]) && text(accountRow[field.accountColumn]) && !same(lead[field.leadColumn], accountRow[field.accountColumn]))
    .map((field) => ({ field: field.key, label: field.label, existing: accountRow[field.accountColumn], lead: lead[field.leadColumn] }));
}
