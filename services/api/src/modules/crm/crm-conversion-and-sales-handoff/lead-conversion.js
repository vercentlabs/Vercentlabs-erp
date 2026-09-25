import { findAccountDuplicates, findContactDuplicates } from "../prospect-and-relationship-master-data/duplicate-matching.js";
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { createCrmRecord } from "../crm-data-operations-and-customization/resource-mutation-service.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { recordScope } from "../crm-data-operations-and-customization/record-policy.js";
import { nextCode } from "../crm-data-operations-and-customization/resource-query-service.js";
import { resources } from "../crm-data-operations-and-customization/resource-registry.js";
import { camelizeRow } from "../crm-data-operations-and-customization/record-utils.js";
import { recordLeadTouchpoint } from "../prospect-and-relationship-master-data/lead-attribution.js";
import { crmAccountVisibleSql, crmContactVisibleSql } from "../crm-data-operations-and-customization/crm-access-scope.js";
async function assertConversionTargetVisible(client, context, kind, id) {
  const parameters = [context.organizationId, id];
  const bind = (value) => { parameters.push(value); return `$${parameters.length}`; };
  const sql = kind === "account"
    ? `SELECT account.id FROM tenant.business_parties account WHERE account.organization_id=$1 AND account.id=$2${crmAccountVisibleSql(context, bind, "account")}`
    : `SELECT contact.id FROM tenant.contacts contact LEFT JOIN tenant.business_parties account ON account.organization_id=contact.organization_id AND account.id=contact.party_id WHERE contact.organization_id=$1 AND contact.id=$2${crmContactVisibleSql(context, bind, "contact", "account")}`;
  const result = await client.query(sql, parameters);
  if (!result.rows[0])
    throw new CrmError(404, kind === "account" ? "Account not found." : "Contact not found.", kind === "account" ? "CRM_ACCOUNT_NOT_FOUND" : "CRM_CONTACT_NOT_FOUND");
}




export function comparable(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}


// F027 Prompt 4: the legacy static-predicate scoring engine
// (tenant.crm_scoring_rules, ruleMatches/calculateLeadScore/recordLeadScore)
// was retired here — it had no model version, cap or decay, and was
// silently governing crm_leads.score on every Lead create/update in
// parallel with the real deterministic engine (System A,
// recalculateLeadScoreInternal, now the sole writer). See migration
// 096_f027_scoring_consolidation.sql.
export function criteriaMatches(input, criteria) {
  if (!criteria || typeof criteria !== "object") return true;
  return Object.entries(criteria).every(([key, expected]) =>
    Array.isArray(expected)
      ? expected.map(comparable).includes(comparable(input[key]))
      : comparable(input[key]) === comparable(expected),
  );
}



export async function convertCrmLead(client, context, leadId, input = {}) {
  const leadParameters = [context.organizationId, leadId];
  const leadResult = await client.query(
    `SELECT record.* FROM tenant.crm_leads record WHERE record.organization_id = $1 AND record.id = $2${recordScope(resources.leads, context, leadParameters)} FOR UPDATE`,
    leadParameters,
  );
  const lead = leadResult.rows[0];
  if (!lead) throw new CrmError(404, "Lead not found.");
  const existing = await client.query(
    `SELECT * FROM tenant.crm_conversion_records WHERE organization_id = $1 AND lead_id = $2 LIMIT 1`,
    [context.organizationId, leadId],
  );
  if (existing.rows[0])
    return { ...camelizeRow(existing.rows[0]), replayed: true };
  if (lead.record_status === "archived")
    throw new CrmError(409, "Archived leads cannot be converted.");
  if (lead.record_status === "converted")
    throw new CrmError(409, "This Lead has already been converted.");
  // F022 CAP-002/F008 reuse: conversion must resolve to an existing Account
  // through the SAME rule-driven duplicate engine every other Account
  // create/update path uses (findAccountDuplicates), not a hand-rolled
  // exact-match query — so a tenant's configured GSTIN/PAN/fuzzy-name rules
  // apply identically here. Only an 'exact' (blocking-rule) candidate is
  // auto-resolved; a merely 'probable' match is not enough to silently
  // attach a Lead to someone else's Account, so conversion falls through to
  // creating a new Account in that case (the caller can still pass an
  // explicit input.partyId to force reuse of a probable match).
  let partyId = input.partyId || null;
  // An explicitly chosen Account/Contact must be one the caller can open
  // (company boundary + ownership) — an id alone never grants reuse.
  if (partyId) await assertConversionTargetVisible(client, context, "account", partyId);
  if (!partyId) {
    const candidates = await findAccountDuplicates(client, context, {
      name: lead.company_name || lead.full_name,
    });
    // Auto-reuse stays inside the caller's company boundary: an exact name
    // match in another company is never silently attached.
    partyId = candidates.find((row) => row.classification === "exact" && row.in_company_scope !== false)?.id || null;
  }
  if (!partyId) {
    const partyCode = await nextCode(
      client,
      context.organizationId,
      "business_party",
    );
    const party = await client.query(
      `INSERT INTO tenant.business_parties (organization_id, company_id, code, party_type, display_name, legal_name, currency_code, created_by, updated_by) VALUES ($1, $2, $3, 'customer', $4, $5, $6, $7, $7) RETURNING id`,
      [
        context.organizationId,
        lead.company_id,
        partyCode,
        lead.company_name || lead.full_name,
        lead.company_name || null,
        lead.currency_code || null,
        context.userId,
      ],
    );
    partyId = party.rows[0].id;
  }
  // Same F008 reuse as the Account resolution above: find the candidate
  // Contact through the governed matcher, then narrow to the one Account
  // conversion just resolved to (findContactDuplicates matches org-wide by
  // design, since email/mobile can legitimately identify the same person
  // across accounts; conversion only wants a duplicate *within this
  // Account*, so an org-wide 'exact' match under a different Account is not
  // reused here and a new Contact is created under the resolved Account
  // instead).
  let contactId = input.contactId || null;
  if (contactId) await assertConversionTargetVisible(client, context, "contact", contactId);
  if (!contactId && (lead.email || lead.mobile || lead.phone)) {
    const candidates = await findContactDuplicates(client, context, {
      email: lead.email,
      mobile: lead.mobile || lead.phone,
      firstName: lead.first_name,
      lastName: lead.last_name,
    });
    contactId =
      candidates.find(
        (row) => row.classification === "exact" && row.party_id === partyId,
      )?.id || null;
  }
  if (!contactId) {
    const contact = await client.query(
      `INSERT INTO tenant.contacts (organization_id, party_id, first_name, last_name, designation, email, phone, mobile, is_primary, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOT EXISTS (SELECT 1 FROM tenant.contacts WHERE organization_id = $1 AND party_id = $2 AND is_primary = true AND status = 'active'), $9, $9) RETURNING id`,
      [
        context.organizationId,
        partyId,
        lead.first_name,
        lead.last_name,
        lead.job_title,
        lead.email,
        lead.phone,
        lead.mobile,
        context.userId,
      ],
    );
    contactId = contact.rows[0].id;
  }
  let opportunityId = null;
  if (input.createOpportunity !== false) {
    const opportunity = await createCrmRecord(
      client,
      context,
      "opportunities",
      {
        companyId: lead.company_id,
        branchId: lead.branch_id,
        leadId,
        partyId,
        contactId,
        campaignId: lead.campaign_id,
        sourceId: lead.source_id,
        ownerUserId: lead.owner_user_id || context.userId,
        name:
          input.opportunityName ||
          `${lead.company_name || lead.full_name} opportunity`,
        amount: input.amount ?? lead.estimated_value ?? 0,
        currencyCode: input.currencyCode || lead.currency_code,
        expectedCloseDate: input.expectedCloseDate || null,
        nextStep:
          input.nextStep || "Complete discovery and confirm requirements",
      },
    );
    opportunityId = opportunity.id;
  }
  await client.query(
    `UPDATE tenant.crm_leads SET record_status = 'converted', converted_at = now(), converted_party_id = $1, converted_contact_id = $2, converted_opportunity_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $5 AND id = $6`,
    [
      partyId,
      contactId,
      opportunityId,
      context.userId,
      context.organizationId,
      leadId,
    ],
  );
  const conversion = await client.query(
    `INSERT INTO tenant.crm_conversion_records (organization_id, lead_id, party_id, contact_id, opportunity_id, converted_by, input_snapshot) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      context.organizationId,
      leadId,
      partyId,
      contactId,
      opportunityId,
      context.userId,
      input,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_campaign_members SET member_status = 'converted', converted_at = now() WHERE organization_id = $1 AND lead_id = $2`,
    [context.organizationId, leadId],
  );
  await recordLeadTouchpoint(client, context, leadId, {
    eventType: "converted",
    channel: "conversion",
    campaignId: lead.campaign_id,
    revenue: lead.estimated_value,
    occurredAt: new Date(),
  });
  await queueOutboxEvent(
    client,
    context,
    "crm.lead.converted",
    "lead",
    leadId,
    { partyId, contactId, opportunityId },
  );
  return { ...camelizeRow(conversion.rows[0]), replayed: false };
}



export async function mergeCrmLead(client, context, sourceId, targetId) {
  if (sourceId === targetId)
    throw new CrmError(400, "A lead cannot be merged into itself.");
  const parameters = [context.organizationId, [sourceId, targetId]];
  const rows = await client.query(
    `SELECT record.* FROM tenant.crm_leads record
      WHERE record.organization_id = $1 AND record.id = ANY($2::uuid[])${recordScope(resources.leads, context, parameters)}
      ORDER BY record.id FOR UPDATE`,
    parameters,
  );
  const source = rows.rows.find((row) => row.id === sourceId);
  const target = rows.rows.find((row) => row.id === targetId);
  if (!source || !target)
    throw new CrmError(404, "Source or target lead was not found.");

  // Check the durable replay marker only after both Lead rows are locked.
  // Concurrent exact retries therefore serialize before any merge side effect.
  const existingMerge = await client.query(
    `SELECT * FROM tenant.crm_merge_records WHERE organization_id = $1 AND entity_type = 'lead' AND source_id = $2`,
    [context.organizationId, sourceId],
  );
  if (existingMerge.rows[0]) {
    if (existingMerge.rows[0].target_id !== targetId)
      throw new CrmError(
        409,
        "This lead has already been merged into another lead.",
      );
    return { ...camelizeRow(existingMerge.rows[0]), replayed: true };
  }
  if (["converted", "archived"].includes(source.record_status))
    throw new CrmError(409, "This lead is no longer available to merge.");
  if (["converted", "archived"].includes(target.record_status))
    throw new CrmError(
      409,
      "The selected lead is no longer available as a merge target.",
    );
  await client.query(
    `INSERT INTO tenant.crm_lead_tags (organization_id, lead_id, tag_id, created_by) SELECT organization_id, $3, tag_id, $4 FROM tenant.crm_lead_tags WHERE organization_id = $1 AND lead_id = $2 ON CONFLICT DO NOTHING`,
    [context.organizationId, sourceId, targetId, context.userId],
  );
  await client.query(
    `UPDATE tenant.crm_activities SET entity_id = $1, updated_by = $2, updated_at = now() WHERE organization_id = $3 AND entity_type = 'lead' AND entity_id = $4`,
    [targetId, context.userId, context.organizationId, sourceId],
  );
  await client.query(
    `UPDATE tenant.crm_communications SET lead_id = $1 WHERE organization_id = $2 AND lead_id = $3`,
    [targetId, context.organizationId, sourceId],
  );
  await client.query(
    `INSERT INTO tenant.crm_campaign_members (organization_id, campaign_id, lead_id, member_status, responded_at, converted_at, created_by) SELECT organization_id, campaign_id, $1, member_status, responded_at, converted_at, $2 FROM tenant.crm_campaign_members WHERE organization_id = $3 AND lead_id = $4 ON CONFLICT DO NOTHING`,
    [targetId, context.userId, context.organizationId, sourceId],
  );
  await client.query(
    `DELETE FROM tenant.crm_campaign_members WHERE organization_id = $1 AND lead_id = $2`,
    [context.organizationId, sourceId],
  );
  await client.query(
    `UPDATE tenant.crm_leads SET record_status = 'archived', updated_by = $1, updated_at = now() WHERE organization_id = $2 AND id = $3`,
    [context.userId, context.organizationId, sourceId],
  );
  const result = await client.query(
    `INSERT INTO tenant.crm_merge_records (organization_id, entity_type, source_id, target_id, merged_by, snapshot) VALUES ($1, 'lead', $2, $3, $4, $5) RETURNING *`,
    [
      context.organizationId,
      sourceId,
      targetId,
      context.userId,
      { source, target },
    ],
  );
  await queueOutboxEvent(client, context, "crm.lead.merged", "lead", targetId, {
    sourceId,
    targetId,
  });
  return { ...camelizeRow(result.rows[0]), replayed: false };
}
