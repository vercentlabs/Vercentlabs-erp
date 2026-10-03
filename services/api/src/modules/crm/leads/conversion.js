// Lead → Account + Contact + Opportunity. One domain operation, one
// transaction: every record is created (or an existing one linked) and the
// lead is stamped with its conversion references, or nothing changes at all.
// The caller's route runs this inside a single tenant transaction, so any
// thrown error rolls the whole conversion back.
//
// Duplicates: creating a new account or contact that resembles an existing
// one refuses the conversion and returns the matching records. The user then
// either links the existing record or confirms the new one (allowDuplicate).
// Account and Contact creation go through their own governed operations, so
// each module's own duplicate rules apply as well.
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { createCrmRecord } from "../data-management/resource-mutation-service.js";
import { accountScopeSql } from "../accounts/access.js";
import { findDuplicateAccounts } from "../accounts/duplicates.js";
import { recordAccountHistory } from "../accounts/history.js";
import { createAccount } from "../accounts/records.js";
import { contactScopeSql } from "../contacts/access.js";
import { findDuplicateContacts } from "../contacts/duplicates.js";
import { recordContactHistory } from "../contacts/history.js";
import { createContact } from "../contacts/records.js";
import { linkContactToAccount } from "../contacts/relationships.js";
import { ensureDefaultSalesPipeline } from "../pipeline/default-pipeline.js";
import { requireLeadPermission } from "./access.js";
import { assertEligibleLeadAssignee } from "./assignment.js";
import { LEAD_PERMISSIONS, LEAD_PURCHASE_TIMEFRAMES } from "./constants.js";
import { recordLeadHistory } from "./history.js";
import { getLead, lockLead } from "./records.js";
import { requireUuid } from "./validation.js";

const TIMEFRAME_LABELS = new Map(LEAD_PURCHASE_TIMEFRAMES.map((entry) => [entry.code, entry.label]));
const text = (value) => String(value ?? "").trim();

const accountMatch = (match) => ({ id: match.id, name: match.name, code: match.code, strength: match.strength });
// People who look like the lead's person. One the caller cannot open is
// reported (so a duplicate is never created behind their back) without its details.
async function contactMatches(client, context, lead, partyId) {
  const { matches } = await findDuplicateContacts(client, context, {
    firstName: lead.first_name || lead.last_name, lastName: lead.first_name ? lead.last_name : null,
    email: lead.email, mobile: lead.mobile, phone: lead.phone, accountId: partyId,
  });
  return matches
    .filter((match) => match.canOpen || match.strength === "exact")
    .map((match) => (match.canOpen
      ? { id: match.id, partyId: match.accountId ?? null, name: match.name, accountName: match.accountName ?? null, email: match.email ?? null, phone: match.mobile ?? null, strength: match.strength, canOpen: true }
      : { id: match.id, partyId: null, name: "A contact you do not have access to", accountName: null, email: null, phone: null, strength: match.strength, canOpen: false }));
}
// Accounts that look like the lead's company. One the caller cannot open is
// reported (so a duplicate is never created behind their back) without its details.
async function accountMatches(client, context, lead, name) {
  const { matches } = await findDuplicateAccounts(client, context, { displayName: name, website: lead.website, email: lead.email, phone: lead.phone, city: lead.city });
  return matches
    .filter((match) => match.canOpen || match.strength === "exact")
    .map((match) => (match.canOpen ? { ...accountMatch(match), canOpen: true } : { id: match.id, name: "An account you do not have access to", code: null, strength: match.strength, canOpen: false }));
}

function leadDisplayName(lead) {
  return lead.company_name || lead.full_name || lead.code;
}

async function assertVisible(client, context, kind, id) {
  const values = [context.organizationId, requireUuid(id, kind === "account" ? "Account" : "Contact")];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const sql = kind === "account"
    ? `SELECT account.id FROM tenant.business_parties account
        WHERE account.organization_id = $1 AND account.id = $2 AND account.status = 'active' AND account.party_type <> 'supplier'${accountScopeSql(context, values, "account")}`
    : `SELECT contact.id, contact.party_id FROM tenant.contacts contact
        WHERE contact.organization_id = $1 AND contact.id = $2 AND contact.status = 'active'${contactScopeSql(context, bind, "contact")}`;
  const { rows } = await client.query(sql, values);
  if (!rows[0]) throw new CrmError(404, kind === "account" ? "Account not found." : "Contact not found.", kind === "account" ? "CRM_ACCOUNT_NOT_FOUND" : "CRM_CONTACT_NOT_FOUND");
  return rows[0];
}

// What the opportunity inherits in words: the lead's description plus its
// qualification answers, so nothing learned while working the lead is lost.
function opportunityDescription(lead) {
  const lines = [];
  if (lead.description) lines.push(lead.description);
  if (lead.product_interest) lines.push(`Product / service interest: ${lead.product_interest}`);
  const qualification = [
    `Need identified: ${lead.need_identified}`,
    `Budget: ${lead.budget_status}${lead.budget_amount !== null ? ` (${lead.budget_amount})` : ""}`,
    `Decision authority: ${lead.decision_authority}`,
    lead.purchase_timeframe ? `Purchase timeframe: ${TIMEFRAME_LABELS.get(lead.purchase_timeframe) ?? lead.purchase_timeframe}` : null,
    lead.qualification_notes ? `Notes: ${lead.qualification_notes}` : null,
  ].filter(Boolean);
  lines.push(`Qualification (from lead ${lead.code})\n${qualification.join("\n")}`);
  return lines.join("\n\n").slice(0, 10000);
}

// Everything the conversion dialog needs: the lead, existing accounts and
// contacts that look like this lead, and the sales stages to choose from.
export async function previewLeadConversion(client, context, leadId) {
  requireLeadPermission(context, LEAD_PERMISSIONS.convert, "You do not have permission to convert leads.");
  const lead = await getLead(client, context, leadId);
  await ensureDefaultSalesPipeline(client, context);
  const accounts = lead.companyName ? (await accountMatches(client, context, lead, lead.companyName)).filter((match) => match.canOpen) : [];
  const leadPerson = { first_name: lead.firstName, last_name: lead.lastName, email: lead.email, mobile: lead.mobile, phone: lead.phone };
  const contacts = lead.fullName ? (await contactMatches(client, context, leadPerson, accounts[0]?.id)).filter((match) => match.canOpen) : [];
  const stages = await client.query(
    `SELECT stage.id, stage.name, pipeline.name AS pipeline_name
       FROM tenant.crm_pipelines pipeline
       JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = pipeline.organization_id AND stage.pipeline_id = pipeline.id
      WHERE pipeline.organization_id = $1 AND pipeline.status = 'active' AND stage.status = 'active' AND NOT stage.is_won AND NOT stage.is_lost
      ORDER BY pipeline.is_default DESC, pipeline.name, stage.sequence`,
    [context.organizationId],
  );
  return {
    lead,
    canConvert: lead.status === "qualified" && !lead.archivedAt,
    canCreateContact: Boolean(lead.fullName && (lead.email || lead.mobile || lead.phone)),
    blockedReason: lead.status === "converted" ? "This lead has already been converted."
      : lead.status !== "qualified" ? "Qualify this lead before converting it." : null,
    accountMatches: accounts,
    contactMatches: contacts,
    stages: stages.rows.map((row) => ({ id: row.id, name: row.name, pipelineName: row.pipeline_name })),
    defaults: {
      accountName: lead.companyName || lead.fullName,
      opportunityName: `${lead.companyName || lead.fullName} — ${lead.productInterest ? lead.productInterest.slice(0, 60) : "New opportunity"}`,
      amount: lead.estimatedValue,
      // Account, contact and opportunity each default to the lead owner and
      // can be given to someone else in the dialog.
      ownerUserId: lead.ownerUserId,
      accountOwnerUserId: lead.ownerUserId,
      contactOwnerUserId: lead.ownerUserId,
      opportunityOwnerUserId: lead.ownerUserId,
    },
  };
}

// input:
//   account:     { id } to link an existing account, or { name, ownerUserId?, allowDuplicate? } to create one
//   contact:     { id } to link an existing contact, or { ownerUserId?, allowDuplicate? } to create one from the lead
// Each new record's owner defaults to the lead owner.
//   opportunity: { create?: boolean (default true), name, amount, productInterest, ownerUserId, stageId, expectedCloseDate }
export async function convertLead(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.convert, "You do not have permission to convert leads.");
  // The row lock makes a second, concurrent conversion wait and then see
  // status = 'converted'.
  const lead = await lockLead(client, context, leadId);
  if (lead.status === "converted") throw new CrmError(409, "This lead has already been converted.", "CRM_LEAD_ALREADY_CONVERTED");
  if (lead.status !== "qualified") throw new CrmError(409, "Qualify this lead before converting it.", "CRM_LEAD_NOT_QUALIFIED");

  const accountInput = input.account || {};
  const contactInput = input.contact || {};
  const opportunityInput = input.opportunity || {};
  const defaultOwnerUserId = lead.owner_user_id || context.userId;
  const ownerUserId = opportunityInput.ownerUserId || defaultOwnerUserId;
  const accountOwnerUserId = accountInput.ownerUserId || defaultOwnerUserId;
  const contactOwnerUserId = contactInput.ownerUserId || defaultOwnerUserId;
  for (const userId of new Set([ownerUserId, accountOwnerUserId, contactOwnerUserId])) await assertEligibleLeadAssignee(client, context, userId);

  // ---- Account: lead company → account
  let partyId;
  if (accountInput.id) {
    partyId = (await assertVisible(client, context, "account", accountInput.id)).id;
  } else {
    const accountName = text(accountInput.name) || leadDisplayName(lead);
    const matches = await accountMatches(client, context, lead, accountName);
    if (matches.length && accountInput.allowDuplicate !== true)
      throw new CrmError(409, "An account like this already exists. Link it, or confirm a new account.", "CRM_LEAD_CONVERSION_ACCOUNT_DUPLICATE", { matches });
    const account = await createAccount(client, context, {
      displayName: accountName,
      industry: lead.industry,
      website: lead.website,
      sourceId: lead.source_id,
      sourceDetail: lead.source_detail,
      currencyCode: lead.currency_code?.trim() || null,
      ownerUserId: accountOwnerUserId,
    }, { allowDuplicate: accountInput.allowDuplicate === true, origin: "lead_conversion", historySummary: `Account created from lead ${lead.code}` });
    partyId = account.id;
  }

  // ---- Contact: lead person → contact
  let contactId = null;
  if (contactInput.id) {
    // An existing person is linked to the account (it becomes their primary
    // company only if they have none); their other companies are kept.
    const contact = await assertVisible(client, context, "contact", contactInput.id);
    if (contact.party_id !== partyId) await linkContactToAccount(client, context, contact.id, { accountId: partyId });
    contactId = contact.id;
  } else if (lead.full_name && (lead.email || lead.mobile || lead.phone)) {
    // A contact needs a name and a way to reach them; a lead with neither
    // converts to an account (and opportunity) without a contact.
    const matches = await contactMatches(client, context, lead, partyId);
    if (matches.length && contactInput.allowDuplicate !== true)
      throw new CrmError(409, "A contact like this already exists. Link it, or confirm a new contact.", "CRM_LEAD_CONVERSION_CONTACT_DUPLICATE", { matches });
    const contact = await createContact(client, context, {
      accountId: partyId,
      firstName: lead.first_name || lead.last_name,
      lastName: lead.first_name ? lead.last_name : null,
      jobTitle: lead.job_title,
      email: lead.email,
      phone: lead.phone,
      mobile: lead.mobile,
      sourceId: lead.source_id,
      ownerUserId: contactOwnerUserId,
    }, { allowDuplicate: contactInput.allowDuplicate === true, origin: "lead_conversion", historySummary: `Contact created from lead ${lead.code}` });
    contactId = contact.id;
  }

  // ---- Opportunity: lead commercial information → opportunity
  let opportunityId = null;
  if (opportunityInput.create !== false) {
    await ensureDefaultSalesPipeline(client, context);
    const productInterest = text(opportunityInput.productInterest) || lead.product_interest;
    const opportunity = await createCrmRecord(client, context, "opportunities", {
      leadId: lead.id,
      partyId,
      contactId,
      sourceId: lead.source_id,
      campaignId: lead.campaign_id,
      ownerUserId,
      name: text(opportunityInput.name) || `${leadDisplayName(lead)} opportunity`,
      description: opportunityDescription({ ...lead, product_interest: productInterest }),
      amount: opportunityInput.amount ?? lead.estimated_value ?? 0,
      currencyCode: lead.currency_code?.trim() || undefined,
      expectedCloseDate: opportunityInput.expectedCloseDate || null,
      ...(opportunityInput.stageId ? { stageId: requireUuid(opportunityInput.stageId, "Sales stage") } : {}),
    });
    opportunityId = opportunity.id;

    // Carry the working record forward: notes are copied, and work still to
    // be done (open tasks and follow-ups) moves to the opportunity. Completed
    // activities and files stay on the lead, which remains readable and is
    // shown on the opportunity's timeline through its lead link.
    await client.query(
      `INSERT INTO tenant.crm_notes (organization_id, entity_type, entity_id, body, is_pinned, visibility, created_by, updated_by, created_at, updated_at)
       SELECT organization_id, 'opportunity', $3, body, is_pinned, visibility, created_by, updated_by, created_at, updated_at
         FROM tenant.crm_notes WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2 AND archived_at IS NULL`,
      [context.organizationId, lead.id, opportunityId],
    );
    await client.query(
      `UPDATE tenant.crm_activities SET entity_type = 'opportunity', entity_id = $3, updated_by = $4
        WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2
          AND activity_type IN ('task', 'follow_up') AND status IN ('planned', 'in_progress', 'overdue')`,
      [context.organizationId, lead.id, opportunityId, context.userId ?? null],
    );
  }

  await client.query(
    `UPDATE tenant.crm_leads SET status = 'converted', converted_at = now(), converted_by = $3,
            converted_party_id = $4, converted_contact_id = $5, converted_opportunity_id = $6, updated_by = $3
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, context.userId ?? null, partyId, contactId, opportunityId],
  );
  if (contactId) await recordContactHistory(client, context, contactId, "lead_converted", `Lead ${lead.code} converted`, { leadId: lead.id, accountId: partyId, opportunityId });
  await recordAccountHistory(client, context, partyId, "lead_converted", `Lead ${lead.code} (${lead.full_name || lead.company_name || lead.code}) converted`, {
    leadId: lead.id, contactId, opportunityId,
  });
  await recordLeadHistory(client, context, lead.id, "converted", "Lead converted", {
    from: lead.status, to: "converted", partyId, contactId, opportunityId,
    accountLinked: Boolean(accountInput.id), contactLinked: Boolean(contactInput.id),
  });
  await queueOutboxEvent(client, context, "crm.lead.converted", "lead", lead.id, { partyId, contactId, opportunityId });
  return { leadId: lead.id, partyId, contactId, opportunityId };
}
