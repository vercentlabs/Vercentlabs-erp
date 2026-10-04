// Reading the records a conversion touches, always in the caller's
// organization and through the caller's own record access.
import { CrmError } from "../data-management/errors.js";
import { accountScopeSql } from "../accounts/access.js";
import { contactScopeSql } from "../contacts/access.js";
import { requireUuid } from "../leads/validation.js";

// An active CRM account the caller can see.
export async function loadVisibleAccount(client, context, accountId) {
  const values = [context.organizationId, requireUuid(accountId, "Account")];
  const { rows } = await client.query(
    `SELECT account.id, account.code, account.display_name, account.website, account.industry, account.owner_user_id, account.currency_code
       FROM tenant.business_parties account
      WHERE account.organization_id = $1 AND account.id = $2 AND account.status = 'active' AND account.party_type <> 'supplier'${accountScopeSql(context, values, "account")}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Choose an active account you have access to.", "CRM_CONVERSION_ACCOUNT_NOT_FOUND");
  return rows[0];
}

// An active contact the caller can see.
export async function loadVisibleContact(client, context, contactId) {
  const values = [context.organizationId, requireUuid(contactId, "Contact")];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const { rows } = await client.query(
    `SELECT contact.id, contact.contact_number, contact.display_name, contact.party_id, contact.email, contact.mobile, contact.phone, contact.designation, contact.owner_user_id
       FROM tenant.contacts contact
      WHERE contact.organization_id = $1 AND contact.id = $2 AND contact.status = 'active'${contactScopeSql(context, bind, "contact")}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Choose an active contact you have access to.", "CRM_CONVERSION_CONTACT_NOT_FOUND");
  return rows[0];
}

const CONVERSION_SELECT = `
  SELECT conversion.*, lead.code AS lead_code, account.display_name AS account_name, contact.display_name AS contact_name,
         opportunity.code AS opportunity_code, opportunity.name AS opportunity_name, converter.full_name AS converted_by_name
    FROM tenant.crm_lead_conversions conversion
    JOIN tenant.crm_leads lead ON lead.organization_id = conversion.organization_id AND lead.id = conversion.lead_id
    LEFT JOIN tenant.business_parties account ON account.organization_id = conversion.organization_id AND account.id = conversion.party_id
    LEFT JOIN tenant.contacts contact ON contact.organization_id = conversion.organization_id AND contact.id = conversion.contact_id
    LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id = conversion.organization_id AND opportunity.id = conversion.opportunity_id
    LEFT JOIN public.users converter ON converter.id = conversion.converted_by`;

export function toConversion(row, { replayed = false } = {}) {
  return {
    id: row.id,
    leadId: row.lead_id,
    leadCode: row.lead_code,
    partyId: row.party_id,
    accountName: row.account_name ?? null,
    contactId: row.contact_id,
    contactName: row.contact_name ?? null,
    opportunityId: row.opportunity_id,
    opportunityCode: row.opportunity_code ?? null,
    opportunityName: row.opportunity_name ?? null,
    accountDecision: row.account_decision,
    contactDecision: row.contact_decision,
    qualificationOverride: row.qualification_override,
    overrideReason: row.override_reason,
    duplicateOverrideReason: row.duplicate_override_reason,
    openWork: row.open_work,
    movedWorkCount: row.moved_work_count,
    convertedBy: row.converted_by,
    convertedByName: row.converted_by_name ?? null,
    convertedAt: row.converted_at,
    replayed,
  };
}

export async function readConversionByLead(client, context, leadId) {
  const { rows } = await client.query(`${CONVERSION_SELECT} WHERE conversion.organization_id = $1 AND conversion.lead_id = $2`, [context.organizationId, leadId]);
  return rows[0] ?? null;
}

export async function readConversionByKey(client, context, idempotencyKey) {
  const { rows } = await client.query(`${CONVERSION_SELECT} WHERE conversion.organization_id = $1 AND conversion.idempotency_key = $2`, [context.organizationId, idempotencyKey]);
  return rows[0] ?? null;
}

export async function userName(client, userId) {
  if (!userId) return null;
  const { rows } = await client.query(`SELECT full_name FROM public.users WHERE id = $1`, [userId]);
  return rows[0]?.full_name ?? null;
}
