// convertLead: Lead → Account + Contact + Opportunity, in the caller's one
// transaction. Either every record is created or linked, the lead is stamped
// converted and the conversion record is written, or nothing changes.
//
//   validate the lead and its qualification (a manager may override, with a reason)
//   check the conversion state (never twice; a retried request returns its first result)
//   resolve the account   existing (visible to the caller) or new (after a duplicate check)
//   resolve the contact   existing (optionally updated from the lead) or new (after a duplicate check)
//   check for similar open deals on the account (a warning to confirm, never a block)
//   create the opportunity (source, owner, team, interest and qualification carried from the lead)
//   move open tasks and follow-ups to the opportunity, unless kept on the lead
//   stamp the lead, write the conversion record and the history
//
// All checks run before the first write, so a refused conversion changes nothing.
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { assertCrmOwnerAssignable } from "../data-management/crm-access-scope.js";
import { recordAccountHistory } from "../accounts/history.js";
import { createAccount } from "../accounts/records.js";
import { recordContactHistory } from "../contacts/history.js";
import { createContact, updateContact } from "../contacts/records.js";
import { linkContactToAccount } from "../contacts/relationships.js";
import { createOpportunity } from "../opportunities/records.js";
import { assertEligibleLeadAssignee } from "../leads/assignment.js";
import { LEAD_AUTHORITY_STATUSES, LEAD_BUDGET_STATUSES, LEAD_PURCHASE_TIMEFRAMES } from "../leads/constants.js";
import { recordLeadHistory } from "../leads/history.js";
import { getLeadQualificationSettings, notifyLeadOutcome } from "../leads/qualification.js";
import { recordLeadQualificationEvent } from "../leads/qualification-history.js";
import { lockLead } from "../leads/records.js";
import { isUuid } from "../leads/validation.js";
import { conversionCapabilities, operationContext, requireConversionPermission } from "./access.js";
import { CONVERSION_PERMISSIONS, MAX_OPPORTUNITY_VALUE, OPEN_WORK_CHOICES } from "./constants.js";
import { accountMatches, contactConflicts, contactMatches, opportunityMatches } from "./matching.js";
import { defaultOpportunityName } from "./preview.js";
import { blockedReason, conversionChecks, missingQualification } from "./readiness.js";
import { loadVisibleAccount, loadVisibleContact, readConversionByKey, readConversionByLead, toConversion, userName } from "./records.js";

const text = (value) => String(value ?? "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLACEHOLDER_NAMES = new Set(["na", "n/a", "none", "nil", "null", "test", "unknown", "company", "-", "--", "..."]);
const labelIn = (list, code) => list.find((entry) => entry.code === code)?.label ?? null;
const invalid = (message, field, code = "CRM_CONVERSION_INVALID") => new CrmError(400, message, code, { field });

function assertAccountName(name) {
  if (!name) throw invalid("Enter the account's company name, or choose an existing account.", "account.name", "CRM_CONVERSION_ACCOUNT_NAME_REQUIRED");
  if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name) || PLACEHOLDER_NAMES.has(name.toLowerCase()))
    throw invalid("Enter the company's real name for the new account.", "account.name", "CRM_CONVERSION_ACCOUNT_NAME_INVALID");
  if (name.length > 200) throw invalid("Use 200 characters or fewer for the account name.", "account.name");
}

// What the lead learned about budget, authority and timing, for the opportunity's commercial notes.
function commercialNotes(lead, overrideReason) {
  const budget = [lead.q_budget_min, lead.q_budget_max].filter((value) => value !== null && value !== undefined).map(Number);
  const lines = [
    `From lead ${lead.code}`,
    lead.q_budget_status && lead.q_budget_status !== "unknown"
      ? `Budget: ${labelIn(LEAD_BUDGET_STATUSES, lead.q_budget_status)}${budget.length ? ` (${[...new Set(budget)].join(" – ")}${lead.currency_code ? ` ${lead.currency_code.trim()}` : ""})` : ""}` : null,
    lead.q_authority_status && lead.q_authority_status !== "unknown"
      ? `Decision authority: ${labelIn(LEAD_AUTHORITY_STATUSES, lead.q_authority_status)}${lead.q_authority_detail ? ` — ${lead.q_authority_detail}` : ""}` : null,
    lead.purchase_timeframe && lead.purchase_timeframe !== "unknown" ? `Purchase timeframe: ${labelIn(LEAD_PURCHASE_TIMEFRAMES, lead.purchase_timeframe)}` : null,
    lead.estimated_value !== null && lead.estimated_value !== undefined ? `Estimated value on the lead: ${Number(lead.estimated_value)}${lead.currency_code ? ` ${lead.currency_code.trim()}` : ""}` : null,
    lead.q_notes ? `Qualification notes: ${lead.q_notes}` : null,
    lead.q_override_reason ? `Qualified with an override: ${lead.q_override_reason}` : null,
    overrideReason ? `Converted with missing qualification: ${overrideReason}` : null,
  ].filter(Boolean);
  return lines.join("\n").slice(0, 10000);
}

function readOpportunityInput(lead, input, accountName) {
  const name = (text(input.name) || defaultOpportunityName(accountName, input.productInterest ?? lead.product_interest)).slice(0, 200);
  const expectedCloseDate = text(input.expectedCloseDate).slice(0, 10);
  if (!expectedCloseDate) throw invalid("Choose the expected close date for the opportunity.", "opportunity.expectedCloseDate", "CRM_CONVERSION_CLOSE_DATE_REQUIRED");
  if (!DATE.test(expectedCloseDate) || Number.isNaN(Date.parse(`${expectedCloseDate}T00:00:00Z`))) throw invalid("Enter a valid expected close date.", "opportunity.expectedCloseDate");
  let amount = lead.estimated_value === null || lead.estimated_value === undefined ? 0 : Number(lead.estimated_value);
  if (input.amount !== undefined && input.amount !== null && text(input.amount) !== "") {
    amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_OPPORTUNITY_VALUE) throw invalid("Enter an estimated value of zero or more.", "opportunity.amount");
    if (Math.round(amount * 100) !== amount * 100) throw invalid("Use at most two decimal places for the estimated value.", "opportunity.amount");
  }
  const currencyCode = text(input.currencyCode).toUpperCase() || lead.currency_code?.trim() || null;
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) throw invalid("Choose a currency from the list.", "opportunity.currencyCode");
  return {
    name,
    expectedCloseDate,
    amount,
    currencyCode,
    stageId: isUuid(input.stageId) ? input.stageId : null,
    teamId: input.teamId === null || input.teamId === "" ? null : isUuid(input.teamId) ? input.teamId : lead.team_id ?? null,
    productInterest: (input.productInterest === undefined ? lead.product_interest ?? "" : text(input.productInterest)).slice(0, 2000) || null,
    description: (input.description === undefined ? lead.description ?? "" : text(input.description)).slice(0, 10000) || null,
    priority: text(input.priority) || lead.priority || null,
    ownerUserId: text(input.ownerUserId) || null,
    acknowledgeMatches: input.acknowledgeMatches === true,
  };
}

// input:
//   idempotencyKey   a retried request with the same key returns the first result
//   account          { mode: "existing", id } | { mode: "new", name, legalName?, website?, gstin? (matched on, never stored), industry?, ownerUserId?, acknowledgeMatches? }
//   contact          { mode: "existing", id, updates?: { email|mobile|phone|jobTitle: "lead" } }
//                    | { mode: "new", firstName, lastName?, email?, mobile?, phone?, jobTitle?, ownerUserId?, acknowledgeMatches? }
//   opportunity      { name?, ownerUserId?, teamId?, stageId?, amount?, currencyCode?, expectedCloseDate, productInterest?, description?, priority?, acknowledgeMatches? }
//   openWork         "move" (default: open tasks and follow-ups move to the opportunity) | "keep"
//   overrideReason   why a lead with missing qualification is converted (managers)
//   duplicateReason  why a new account or contact is created despite a strong match (managers)
export async function convertLead(client, context, leadId, input = {}) {
  requireConversionPermission(context, CONVERSION_PERMISSIONS.convert, "You do not have permission to convert leads.");
  const idempotencyKey = text(input.idempotencyKey).slice(0, 200) || null;
  if (idempotencyKey) {
    const prior = await readConversionByKey(client, context, idempotencyKey);
    if (prior) {
      if (prior.lead_id !== leadId) throw new CrmError(409, "This request was already used for another lead. Reload and try again.", "CRM_CONVERSION_KEY_REUSED");
      return toConversion(prior, { replayed: true });
    }
  }

  // ---- validateLead / checkConversionState. The row lock makes a second,
  // concurrent conversion wait, then find the lead converted.
  const lead = await lockLead(client, context, leadId, { includeArchived: true });
  if (lead.status === "converted") {
    const done = await readConversionByLead(client, context, lead.id);
    if (done && idempotencyKey && done.idempotency_key === idempotencyKey) return toConversion(done, { replayed: true });
    throw new CrmError(409, "This lead has already been converted.", "CRM_LEAD_ALREADY_CONVERTED", { conversion: done ? toConversion(done) : null });
  }
  const blocked = blockedReason(lead);
  if (blocked) throw new CrmError(409, blocked.message, blocked.code);

  // ---- validateQualification
  const capabilities = conversionCapabilities(context);
  const checks = conversionChecks(lead, await getLeadQualificationSettings(client, context));
  const missing = missingQualification(checks);
  let overrideReason = null;
  if (missing.length) {
    const detail = { missing, canOverride: capabilities.overrideQualification };
    if (!capabilities.overrideQualification)
      throw new CrmError(409, `This lead cannot be converted yet. Missing: ${missing.map((entry) => entry.label).join(", ")}.`, "CRM_CONVERSION_QUALIFICATION_INCOMPLETE", detail);
    overrideReason = text(input.overrideReason).slice(0, 500);
    if (!overrideReason)
      throw new CrmError(409, `Give a reason to convert with missing qualification: ${missing.map((entry) => entry.label).join(", ")}.`, "CRM_CONVERSION_OVERRIDE_REASON_REQUIRED", detail);
  }

  const openWork = OPEN_WORK_CHOICES.includes(input.openWork) ? input.openWork : "move";
  const duplicateReason = text(input.duplicateReason).slice(0, 500);
  const duplicateOverrides = [];
  const leadOwner = lead.owner_user_id || context.userId;
  // Every new record defaults to the lead owner; another owner needs the change-owner permission.
  async function ownerFor(requested, label, teamId = null) {
    const owner = text(requested) || leadOwner;
    if (owner !== leadOwner) {
      if (!capabilities.changeOwner) throw new CrmError(403, `You do not have permission to give the ${label} an owner other than the lead owner.`, "PERMISSION_DENIED");
      await assertCrmOwnerAssignable(client, context, owner, `You can only give the ${label} to yourself or to members of a team you manage.`);
    }
    await assertEligibleLeadAssignee(client, context, owner, { teamId });
    return owner;
  }
  // A strong match blocks a new record unless a manager overrides it with a
  // reason; a possible match only needs the salesperson to confirm.
  function duplicateGate(kind, matches, confirmed) {
    const article = kind === "account" ? "An account" : "A contact";
    const strong = matches.filter((match) => match.strength === "exact");
    if (strong.length) {
      const detail = { matches, canOverride: capabilities.overrideDuplicate };
      const code = kind === "account" ? "CRM_CONVERSION_ACCOUNT_DUPLICATE" : "CRM_CONVERSION_CONTACT_DUPLICATE";
      if (!capabilities.overrideDuplicate) throw new CrmError(409, `${article} like this already exists. Use the existing ${kind}.`, code, detail);
      if (!duplicateReason) throw new CrmError(409, `${article} like this already exists. Use it, or give a reason to create a new ${kind}.`, code, { ...detail, reasonRequired: true });
      duplicateOverrides.push({ kind, matchedIds: strong.map((match) => match.id) });
      return true;
    }
    if (matches.length && !confirmed)
      throw new CrmError(409, `Possible matching ${kind}s found. Use one of them, or confirm a new ${kind}.`, kind === "account" ? "CRM_CONVERSION_ACCOUNT_POSSIBLE_DUPLICATE" : "CRM_CONVERSION_CONTACT_POSSIBLE_DUPLICATE", { matches });
    return false;
  }

  // ---- resolveAccount
  const accountInput = input.account ?? {};
  const accountMode = accountInput.mode ?? (accountInput.id ? "existing" : "new");
  let existingAccount = null;
  let newAccount = null;
  if (accountMode === "existing") {
    if (!capabilities.useExisting) throw new CrmError(403, "You do not have permission to convert into an existing account.", "PERMISSION_DENIED");
    existingAccount = await loadVisibleAccount(client, context, accountInput.id);
  } else if (accountMode === "new") {
    if (!capabilities.createAccount) throw new CrmError(403, "You do not have permission to create an account while converting. Choose an existing account.", "PERMISSION_DENIED");
    const name = text(accountInput.name) || text(lead.company_name);
    assertAccountName(name);
    newAccount = {
      displayName: name,
      legalName: text(accountInput.legalName) || null,
      website: (accountInput.website === undefined ? text(lead.website) : text(accountInput.website)) || null,
      gstin: text(accountInput.gstin).toUpperCase() || null,
      industry: (accountInput.industry === undefined ? text(lead.industry) : text(accountInput.industry)) || null,
    };
    const matches = await accountMatches(client, context, { ...newAccount, email: lead.email, phone: lead.phone, city: lead.city });
    newAccount.allowDuplicate = duplicateGate("account", matches, accountInput.acknowledgeMatches === true);
    newAccount.ownerUserId = await ownerFor(accountInput.ownerUserId, "account");
  } else {
    throw invalid("Choose an existing account or create a new one.", "account.mode");
  }

  // ---- resolveContact
  const contactInput = input.contact ?? {};
  const contactMode = contactInput.mode ?? (contactInput.id ? "existing" : "new");
  let existingContact = null;
  let newContact = null;
  const contactUpdates = {};
  if (contactMode === "existing") {
    if (!capabilities.useExisting) throw new CrmError(403, "You do not have permission to convert into an existing contact.", "PERMISSION_DENIED");
    existingContact = await loadVisibleContact(client, context, contactInput.id);
    const chosen = contactInput.updates && typeof contactInput.updates === "object" ? contactInput.updates : {};
    for (const conflict of contactConflicts(lead, existingContact)) if (chosen[conflict.field] === "lead") contactUpdates[conflict.field] = conflict.lead;
  } else if (contactMode === "new") {
    if (!capabilities.createContact) throw new CrmError(403, "You do not have permission to create a contact while converting. Choose an existing contact.", "PERMISSION_DENIED");
    const pick = (key, column) => (contactInput[key] === undefined ? text(lead[column]) : text(contactInput[key])) || null;
    newContact = {
      firstName: pick("firstName", "first_name"), lastName: pick("lastName", "last_name"), email: pick("email", "email"),
      mobile: pick("mobile", "mobile"), phone: pick("phone", "phone"), jobTitle: pick("jobTitle", "job_title"),
    };
    if (!newContact.firstName && newContact.lastName) [newContact.firstName, newContact.lastName] = [newContact.lastName, null];
    if (!newContact.firstName) throw invalid("Enter the contact's name, or choose an existing contact.", "contact.firstName", "CRM_CONVERSION_CONTACT_INCOMPLETE");
    if (!newContact.email && !newContact.mobile && !newContact.phone)
      throw invalid("Enter an email, mobile or phone for the contact, or choose an existing contact.", "contact.email", "CRM_CONVERSION_CONTACT_INCOMPLETE");
    const matches = await contactMatches(client, context, newContact, existingAccount?.id ?? null);
    newContact.allowDuplicate = duplicateGate("contact", matches, contactInput.acknowledgeMatches === true);
    newContact.ownerUserId = await ownerFor(contactInput.ownerUserId, "contact");
  } else {
    throw invalid("Choose an existing contact or create a new one.", "contact.mode");
  }

  // ---- checkDuplicates (opportunity) and the opportunity's own values
  const opportunityInput = readOpportunityInput(lead, input.opportunity ?? {}, existingAccount?.display_name ?? newAccount.displayName);
  const today = (await client.query(`SELECT current_date::text AS today`)).rows[0].today;
  if (opportunityInput.expectedCloseDate < today) throw invalid("Choose today or a later date as the expected close date.", "opportunity.expectedCloseDate");
  if (existingAccount) {
    const similar = (await opportunityMatches(client, context, existingAccount.id, opportunityInput)).filter((deal) => deal.similar);
    if (similar.length && !opportunityInput.acknowledgeMatches)
      throw new CrmError(409, "This account already has a similar open opportunity. Open it, or confirm a new opportunity.", "CRM_CONVERSION_OPPORTUNITY_POSSIBLE_DUPLICATE", { matches: similar });
  }
  const opportunityOwner = await ownerFor(opportunityInput.ownerUserId, "opportunity", opportunityInput.teamId);

  // ---- every check passed: write
  const operations = operationContext(context, { overrideDuplicate: duplicateOverrides.length > 0 });
  const activeSource = lead.source_id
    ? (await client.query(`SELECT status FROM tenant.crm_lead_sources WHERE organization_id = $1 AND id = $2`, [context.organizationId, lead.source_id])).rows[0]?.status === "active"
    : false;

  let partyId = existingAccount?.id;
  if (newAccount) {
    // GSTIN is only matched on: tax identity is kept by the Customer Master in Sales.
    const account = await createAccount(client, operations, {
      displayName: newAccount.displayName, legalName: newAccount.legalName, website: newAccount.website, industry: newAccount.industry,
      ...(activeSource ? { sourceId: lead.source_id, sourceDetail: lead.source_detail } : {}),
      currencyCode: opportunityInput.currencyCode || lead.currency_code?.trim() || null,
      ownerUserId: newAccount.ownerUserId,
    }, { allowDuplicate: newAccount.allowDuplicate, duplicateReason, origin: "lead_conversion", historySummary: `Account created from lead ${lead.code}` });
    partyId = account.id;
  }

  let contactId = existingContact?.id;
  if (existingContact) {
    // An existing person is linked to the account; their other companies are kept.
    if (existingContact.party_id !== partyId) await linkContactToAccount(client, operations, existingContact.id, { accountId: partyId });
    if (Object.keys(contactUpdates).length) await updateContact(client, operations, existingContact.id, contactUpdates);
  } else {
    const contact = await createContact(client, operations, {
      accountId: partyId, firstName: newContact.firstName, lastName: newContact.lastName, jobTitle: newContact.jobTitle,
      email: newContact.email, mobile: newContact.mobile, phone: newContact.phone,
      ...(activeSource ? { sourceId: lead.source_id } : {}),
      ownerUserId: newContact.ownerUserId,
    }, { allowDuplicate: newContact.allowDuplicate, duplicateReason, origin: "lead_conversion", historySummary: `Contact created from lead ${lead.code}` });
    contactId = contact.id;
  }

  // ---- createOpportunity: the deal keeps the lead's source, even for an existing account or contact.
  const opportunity = await createOpportunity(client, operations, {
    leadId: lead.id,
    accountId: partyId,
    contactId,
    sourceId: lead.source_id,
    campaignId: lead.campaign_id,
    ownerUserId: opportunityOwner,
    ...(opportunityInput.teamId ? { teamId: opportunityInput.teamId } : {}),
    name: opportunityInput.name,
    description: opportunityInput.description,
    productInterest: opportunityInput.productInterest,
    businessProblem: lead.q_need_description ?? null,
    commercialNotes: commercialNotes(lead, overrideReason),
    ...(opportunityInput.priority ? { priority: opportunityInput.priority } : {}),
    amount: opportunityInput.amount,
    ...(opportunityInput.currencyCode ? { currencyCode: opportunityInput.currencyCode } : {}),
    expectedCloseDate: opportunityInput.expectedCloseDate,
    ...(opportunityInput.stageId ? { stageId: opportunityInput.stageId } : {}),
  }, { origin: "lead_conversion", historySummary: `Created from lead ${lead.code}` });

  // ---- transferRelevantOpenWork: future work follows the deal; completed work stays on the lead.
  let movedWorkCount = 0;
  if (openWork === "move") {
    const moved = await client.query(
      `UPDATE tenant.crm_activities SET entity_type = 'opportunity', entity_id = $3, updated_by = $4,
              origin_lead_id = CASE WHEN activity_type = 'follow_up' THEN $2 ELSE origin_lead_id END
        WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2
          AND activity_type IN ('task', 'follow_up') AND status IN ('planned', 'in_progress', 'overdue')`,
      [context.organizationId, lead.id, opportunity.id, context.userId ?? null],
    );
    movedWorkCount = moved.rowCount ?? 0;
  }

  // ---- linkConversionRecords / markLeadConverted
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'converted', converted_at = now(), converted_by = $3,
            converted_party_id = $4, converted_contact_id = $5, converted_opportunity_id = $6, updated_by = $3
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, context.userId ?? null, partyId, contactId, opportunity.id],
  );
  await client.query(
    `INSERT INTO tenant.crm_lead_conversions (organization_id, lead_id, party_id, contact_id, opportunity_id, account_decision, contact_decision, lead_status_before,
       qualification_override, override_reason, missing_criteria, duplicate_override_reason, duplicate_overrides, contact_updates, open_work, moved_work_count,
       lead_owner_user_id, lead_source_id, lead_created_at, idempotency_key, converted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, $14::jsonb, $15, $16, $17, $18, $19, $20, $21)`,
    [context.organizationId, lead.id, partyId, contactId, opportunity.id, existingAccount ? "existing" : "new", existingContact ? "existing" : "new", lead.status,
      Boolean(overrideReason), overrideReason, JSON.stringify(missing), duplicateOverrides.length ? duplicateReason : null, JSON.stringify(duplicateOverrides),
      JSON.stringify(contactUpdates), openWork, movedWorkCount, lead.owner_user_id ?? null, lead.source_id ?? null, lead.created_at, idempotencyKey, context.userId ?? null],
  );

  // ---- writeHistory
  const actor = (await userName(client, context.userId)) ?? "someone";
  const decisions = {
    from: lead.status, to: "converted", partyId, contactId, opportunityId: opportunity.id,
    account: existingAccount ? "existing" : "new", contact: existingContact ? "existing" : "new", openWork, movedWorkCount,
    ...(Object.keys(contactUpdates).length ? { contactUpdates: Object.keys(contactUpdates) } : {}),
    ...(overrideReason ? { qualificationOverride: { missing: missing.map((entry) => entry.key), reason: overrideReason } } : {}),
    ...(duplicateOverrides.length ? { duplicateOverride: { reason: duplicateReason, overrides: duplicateOverrides } } : {}),
  };
  await recordLeadHistory(client, context, lead.id, "converted", `Lead converted by ${actor}. Opportunity ${opportunity.code} created`, decisions);
  // Each override gets its own line in the lead's history (kept under the "converted" event).
  if (overrideReason)
    await recordLeadHistory(client, context, lead.id, "converted", `Converted with missing qualification (${missing.map((entry) => entry.label).join(", ")}): ${overrideReason}`,
      { kind: "qualification_override", ...decisions.qualificationOverride });
  if (duplicateOverrides.length)
    await recordLeadHistory(client, context, lead.id, "converted", `New ${duplicateOverrides.map((entry) => entry.kind).join(" and ")} created despite a matching record: ${duplicateReason}`,
      { kind: "duplicate_override", ...decisions.duplicateOverride });
  await recordAccountHistory(client, context, partyId, "lead_converted", `Lead ${lead.code} (${lead.full_name || lead.company_name || lead.code}) converted${existingAccount ? " into this account" : ""}`, { leadId: lead.id, contactId, opportunityId: opportunity.id });
  await recordContactHistory(client, context, contactId, "lead_converted", `Lead ${lead.code} converted${Object.keys(contactUpdates).length ? `; updated ${Object.keys(contactUpdates).join(", ")} from the lead` : ""}`,
    { leadId: lead.id, accountId: partyId, opportunityId: opportunity.id, ...(Object.keys(contactUpdates).length ? { updated: contactUpdates } : {}) });
  await recordLeadQualificationEvent(client, context, lead.id, { type: "converted", newValue: `Opportunity ${opportunity.code} created`, notes: overrideReason });
  await notifyLeadOutcome(client, context, lead, "Your lead was converted", `Opportunity ${opportunity.code} was created`);
  await queueOutboxEvent(client, context, "crm.lead.converted", "lead", lead.id, { partyId, contactId, opportunityId: opportunity.id });
  return toConversion(await readConversionByLead(client, context, lead.id));
}
