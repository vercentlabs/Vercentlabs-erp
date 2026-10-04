// The contact record: create, read, list, update, status changes and
// deletion of contacts with no history. Owner and team change only through
// assignment.js; company links through relationships.js.
import { accountScopeSql } from "../accounts/access.js";
import { recordAccountHistory } from "../accounts/history.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { assertCrmOwnerAssignable } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { managedTeamMembersSql } from "../data-management/record-utils.js";
import { contactCan, contactCapabilities, contactScopeValues, projectContactForContext, requireContactPermission } from "./access.js";
import { applyContactAssignment } from "./assignment.js";
import { CONTACT_NUMBER_DOCUMENT_TYPE, CONTACT_PERMISSIONS, contactRoleLabel, contactStatusLabel } from "./constants.js";
import { recordDuplicateOverride } from "../duplicates/policy.js";
import { assertNoBlockingContactDuplicate } from "./duplicates.js";
import { recordContactHistory } from "./history.js";
import { CONTACT_WRITABLE_COLUMNS, ROLE_FIELDS, assertValidContact, composeDisplayName, isUuid, normalizeContactInput, requireUuid } from "./validation.js";

const BULK_LIMIT = 200;
const IDENTITY_FIELDS = ["firstName", "lastName", "email", "secondaryEmail", "phone", "mobile", "alternatePhone"];
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const CONTACT_SELECT = `
  SELECT contact.*, owner.full_name AS owner_name, team.name AS team_name, source.name AS source_name,
         account.display_name AS account_name, account.code AS account_code, account.account_type AS account_type, account.owner_user_id AS account_owner_user_id,
         creator.full_name AS created_by_name, updater.full_name AS updated_by_name,
         follow_up.next_follow_up_at,
         (SELECT count(*) FROM tenant.crm_opportunities opportunity
           WHERE opportunity.organization_id = contact.organization_id AND opportunity.status = 'open'
             AND (opportunity.contact_id = contact.id OR EXISTS (SELECT 1 FROM tenant.crm_opportunity_contact_roles ocr
                   WHERE ocr.organization_id = opportunity.organization_id AND ocr.opportunity_id = opportunity.id AND ocr.contact_id = contact.id AND ocr.status = 'active')))::int AS open_opportunities,
         (SELECT count(*) FROM tenant.crm_contact_account_relationships r WHERE r.organization_id = contact.organization_id AND r.contact_id = contact.id AND r.status = 'active')::int AS company_count,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', tag.id, 'name', tag.name, 'color', tag.color) ORDER BY tag.name)
                     FROM tenant.crm_contact_tags contact_tag
                     JOIN tenant.crm_tags tag ON tag.organization_id = contact_tag.organization_id AND tag.id = contact_tag.tag_id
                    WHERE contact_tag.organization_id = contact.organization_id AND contact_tag.contact_id = contact.id), '[]'::jsonb) AS tags
    FROM tenant.contacts contact
    LEFT JOIN public.users owner ON owner.id = contact.owner_user_id
    LEFT JOIN public.users creator ON creator.id = contact.created_by
    LEFT JOIN public.users updater ON updater.id = contact.updated_by
    LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = contact.organization_id AND team.id = contact.team_id
    LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = contact.organization_id AND source.id = contact.source_id
    LEFT JOIN tenant.business_parties account ON account.organization_id = contact.organization_id AND account.id = contact.party_id
    LEFT JOIN LATERAL (
      SELECT min(activity.due_at) AS next_follow_up_at FROM tenant.crm_activities activity
       WHERE activity.organization_id = contact.organization_id AND activity.entity_type = 'contact' AND activity.entity_id = contact.id
         AND activity.activity_type = 'follow_up' AND activity.status IN ('planned', 'in_progress', 'overdue')) follow_up ON true`;

export function toContact(row) {
  return {
    id: row.id,
    contactNumber: row.contact_number,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    displayName: row.display_name || composeDisplayName({ firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name }),
    accountId: row.party_id,
    accountName: row.account_name ?? null,
    accountCode: row.account_code ?? null,
    accountType: row.account_type ?? null,
    jobTitle: row.designation,
    department: row.department,
    role: row.contact_role,
    roleLabel: row.contact_role ? contactRoleLabel(row.contact_role) : null,
    isDecisionMaker: row.is_decision_maker,
    isPrimary: row.is_primary,
    email: row.email,
    secondaryEmail: row.secondary_email,
    phone: row.phone,
    mobile: row.mobile,
    alternatePhone: row.alternate_phone,
    preferredContactMethod: row.preferred_contact_method,
    doNotEmail: row.do_not_email,
    doNotCall: row.do_not_call,
    doNotSms: row.do_not_sms,
    marketingConsent: row.marketing_consent,
    useAccountAddress: row.use_account_address,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    status: row.status,
    sourceId: row.source_id,
    sourceName: row.source_name ?? null,
    description: row.description,
    tags: row.tags ?? [],
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name ?? null,
    teamId: row.team_id,
    teamName: row.team_name ?? null,
    assignedAt: row.assigned_at,
    companyCount: row.company_count ?? 0,
    openOpportunities: row.open_opportunities ?? 0,
    lastActivityAt: row.last_activity_at,
    nextFollowUpAt: row.next_follow_up_at ?? null,
    archivedAt: row.archived_at,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
  };
}

// ------------------------------------------------------------------ read

async function loadContactRow(client, context, contactId, { lock = false, skipScope = false } = {}) {
  const values = [context.organizationId, requireUuid(contactId, "Contact")];
  const scope = skipScope ? "" : contactScopeValues(context, values, "contact");
  const { rows } = await client.query(
    `${CONTACT_SELECT} WHERE contact.organization_id = $1 AND contact.id = $2${scope}${lock ? " FOR UPDATE OF contact" : ""}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Contact not found.", "CRM_CONTACT_NOT_FOUND");
  return rows[0];
}

export async function lockContact(client, context, contactId, options = {}) {
  return loadContactRow(client, context, contactId, { ...options, lock: true });
}

export async function getContact(client, context, contactId) {
  requireContactPermission(context, CONTACT_PERMISSIONS.view, "You do not have permission to view contacts.");
  return projectContactForContext(context, toContact(await loadContactRow(client, context, contactId)));
}

// ------------------------------------------------------------------ list

export const CONTACT_VIEWS = Object.freeze([
  { key: "all", label: "All Contacts" },
  { key: "mine", label: "My Contacts" },
  { key: "team", label: "Team Contacts" },
  { key: "active", label: "Active Contacts" },
  { key: "inactive", label: "Inactive Contacts" },
  { key: "decision_makers", label: "Decision Makers" },
  { key: "without_company", label: "Contacts without Company" },
  { key: "recently_created", label: "Recently Created" },
  { key: "recently_updated", label: "Recently Updated" },
  { key: "archived", label: "Archived" },
]);

const SORT_COLUMNS = Object.freeze({
  displayName: "lower(COALESCE(contact.display_name, contact.first_name))",
  contactNumber: "contact.contact_number",
  accountName: "lower(account.display_name)",
  jobTitle: "lower(contact.designation)",
  department: "lower(contact.department)",
  ownerName: "lower(owner.full_name)",
  status: "contact.status",
  lastActivityAt: "contact.last_activity_at",
  nextFollowUpAt: "follow_up.next_follow_up_at",
  createdAt: "contact.created_at",
  updatedAt: "contact.updated_at",
});
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The WHERE clause shared by the list, the export and the bulk operations,
// so "what I see" and "what I export" can never differ.
export function buildContactListWhere(context, filters = {}, values = []) {
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = [`contact.organization_id = ${bind(context.organizationId)}`];
  const view = filters.view || "all";
  if (view === "archived") where.push("contact.status = 'archived'");
  else if (view === "inactive") where.push("contact.status = 'inactive'");
  else if (view === "active") where.push("contact.status = 'active'");
  else if (!filters.status) where.push("contact.status <> 'archived'");
  if (view === "mine") where.push(`contact.owner_user_id = ${bind(context.userId)}`);
  if (view === "team") {
    const me = bind(context.userId);
    where.push(`(contact.owner_user_id IN (${managedTeamMembersSql("contact.organization_id", me)})
      OR contact.team_id IN (SELECT team.id FROM tenant.crm_sales_teams team WHERE team.organization_id = contact.organization_id AND team.status = 'active'
        AND (team.manager_user_id = ${me} OR EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member
              WHERE member.organization_id = team.organization_id AND member.team_id = team.id AND member.user_id = ${me} AND member.status = 'active'))))`);
  }
  if (view === "decision_makers") where.push("contact.is_decision_maker");
  if (view === "without_company") where.push("contact.party_id IS NULL");
  if (view === "recently_created") where.push("contact.created_at >= now() - interval '30 days'");
  if (view === "recently_updated") where.push("contact.updated_at >= now() - interval '30 days'");

  if (filters.status) where.push(`contact.status = ${bind(String(filters.status))}`);
  if (isUuid(filters.accountId))
    where.push(`EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships r WHERE r.organization_id = contact.organization_id AND r.contact_id = contact.id AND r.party_id = ${bind(filters.accountId)})`);
  if (filters.ownerId === "unassigned") where.push("contact.owner_user_id IS NULL");
  else if (filters.ownerId === "me") where.push(`contact.owner_user_id = ${bind(context.userId)}`);
  else if (isUuid(filters.ownerId)) where.push(`contact.owner_user_id = ${bind(filters.ownerId)}`);
  if (isUuid(filters.teamId)) where.push(`contact.team_id = ${bind(filters.teamId)}`);
  if (filters.department) where.push(`lower(contact.department) = lower(${bind(String(filters.department))})`);
  if (filters.role) where.push(`contact.contact_role = ${bind(String(filters.role))}`);
  if (isUuid(filters.sourceId)) where.push(`contact.source_id = ${bind(filters.sourceId)}`);
  if (filters.countryCode) {
    const country = bind(String(filters.countryCode).toUpperCase());
    where.push(`(contact.country_code = ${country} OR EXISTS (SELECT 1 FROM tenant.addresses a WHERE a.organization_id = contact.organization_id
      AND a.party_id = contact.party_id AND a.status = 'active' AND a.country_code = ${country}))`);
  }
  if (DATE.test(String(filters.createdFrom ?? ""))) where.push(`contact.created_at >= ${bind(filters.createdFrom)}::date`);
  if (DATE.test(String(filters.createdTo ?? ""))) where.push(`contact.created_at < ${bind(filters.createdTo)}::date + interval '1 day'`);
  if (DATE.test(String(filters.lastActivityBefore ?? ""))) where.push(`(contact.last_activity_at IS NULL OR contact.last_activity_at < ${bind(filters.lastActivityBefore)}::date)`);
  if (filters.isDecisionMaker === "yes") where.push("contact.is_decision_maker");
  if (filters.isDecisionMaker === "no") where.push("NOT contact.is_decision_maker");
  if (filters.isPrimary === "yes") where.push("contact.is_primary");
  if (filters.isPrimary === "no") where.push("NOT contact.is_primary");
  if (isUuid(filters.tagId))
    where.push(`EXISTS (SELECT 1 FROM tenant.crm_contact_tags t WHERE t.organization_id = contact.organization_id AND t.contact_id = contact.id AND t.tag_id = ${bind(filters.tagId)})`);
  if (Array.isArray(filters.ids) && filters.ids.length) where.push(`contact.id = ANY (${bind(filters.ids.filter(isUuid))}::uuid[])`);

  const search = String(filters.search ?? "").trim().toLowerCase();
  if (search) {
    const pattern = bind(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    const details = contactCan(context, CONTACT_PERMISSIONS.viewSensitive)
      ? "|| ' ' || COALESCE(contact.email, '') || ' ' || COALESCE(contact.secondary_email, '') || ' ' || COALESCE(contact.phone, '') || ' ' || COALESCE(contact.mobile, '') || ' ' || COALESCE(contact.alternate_phone, '')"
      : "";
    const digits = search.replace(/\D/g, "");
    where.push(`(lower(COALESCE(contact.contact_number, '') || ' ' || COALESCE(contact.display_name, '') || ' ' || contact.first_name || ' ' || COALESCE(contact.middle_name, '') || ' '
        || COALESCE(contact.last_name, '') || ' ' || COALESCE(contact.designation, '') || ' ' || COALESCE(account.display_name, '') ${details}) LIKE ${pattern}${
      details && digits.length >= 5 ? ` OR contact.normalized_mobile LIKE ${bind(`%${digits}`)} OR contact.normalized_work_phone LIKE $${values.length}` : ""})`);
  }
  return `WHERE ${where.join(" AND ")}${contactScopeValues(context, values, "contact")}`;
}

export async function listContacts(client, context, filters = {}) {
  requireContactPermission(context, CONTACT_PERMISSIONS.view, "You do not have permission to view contacts.");
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const view = filters.view || "all";
  const defaultSort = view === "recently_created" ? "createdAt" : "updatedAt";
  const sortColumn = SORT_COLUMNS[filters.sortBy] ?? SORT_COLUMNS[defaultSort];
  const sortDirection = String(filters.sortDirection).toLowerCase() === "asc" ? "ASC" : "DESC";
  const values = [];
  const where = buildContactListWhere(context, filters, values);
  const total = await client.query(
    `SELECT count(*)::int AS total FROM tenant.contacts contact
       LEFT JOIN tenant.business_parties account ON account.organization_id = contact.organization_id AND account.id = contact.party_id ${where}`,
    values,
  );
  const { rows } = await client.query(`${CONTACT_SELECT} ${where} ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, contact.id DESC LIMIT ${limit} OFFSET ${offset}`, values);
  return {
    contacts: rows.map((row) => projectContactForContext(context, toContact(row))),
    total: total.rows[0].total,
    limit,
    offset,
    capabilities: contactCapabilities(context),
  };
}

// ------------------------------------------------------------------ create

export async function setContactTags(client, context, contactId, tagIds) {
  const ids = [...new Set((Array.isArray(tagIds) ? tagIds : []).filter(isUuid))];
  await client.query(`DELETE FROM tenant.crm_contact_tags WHERE organization_id = $1 AND contact_id = $2 AND NOT (tag_id = ANY ($3::uuid[]))`, [context.organizationId, contactId, ids]);
  if (!ids.length) return;
  await client.query(
    `INSERT INTO tenant.crm_contact_tags (organization_id, contact_id, tag_id, created_by)
     SELECT $1, $2, tag.id, $4 FROM tenant.crm_tags tag WHERE tag.organization_id = $1 AND tag.id = ANY ($3::uuid[]) AND tag.status = 'active'
     ON CONFLICT DO NOTHING`,
    [context.organizationId, contactId, ids, context.userId ?? null],
  );
}

async function assertActiveSource(client, context, sourceId) {
  if (!sourceId) return;
  const { rows } = await client.query(`SELECT status FROM tenant.crm_lead_sources WHERE organization_id = $1 AND id = $2`, [context.organizationId, requireUuid(sourceId, "Source")]);
  if (!rows[0]) throw new CrmError(400, "Choose a source from the list.", "CRM_CONTACT_SOURCE_INVALID");
  if (rows[0].status !== "active") throw new CrmError(409, "This source is no longer active. Choose another.", "CRM_CONTACT_SOURCE_INACTIVE");
}

// The account a new contact joins: visible to the caller and in use.
export async function loadLinkableAccount(client, context, accountId) {
  const values = [context.organizationId, requireUuid(accountId, "Account")];
  const { rows } = await client.query(
    `SELECT account.id, account.display_name, account.code, account.owner_user_id, account.status FROM tenant.business_parties account
      WHERE account.organization_id = $1 AND account.id = $2 AND account.party_type <> 'supplier'${accountScopeSql(context, values, "account")}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Account not found.", "CRM_ACCOUNT_NOT_FOUND");
  if (rows[0].status === "archived") throw new CrmError(409, "This account is archived. Choose an active account.", "CRM_ACCOUNT_ARCHIVED");
  return rows[0];
}

// options:
//   allowDuplicate  the caller confirmed a strong duplicate is a different person
//   origin          recorded in history: "manual" | "import" | "lead_conversion" | "account"
//   makePrimary     the contact becomes the account's primary contact
//   duplicateReason   why a strong duplicate is saved anyway (with allowDuplicate; needs crm.duplicates.override)
//   onDuplicateCheck  receives what the duplicate check found (imports count possible duplicates)
export async function createContact(client, context, input = {}, {
  allowDuplicate = false, duplicateReason = null, onDuplicateCheck = null, origin = "manual", makePrimary = false, historySummary = null,
} = {}) {
  requireContactPermission(context, CONTACT_PERMISSIONS.create, "You do not have permission to create contacts.");
  const { ownerUserId: requestedOwner, teamId, accountId, tagIds, duplicateReason: inputReason, ...fields } = input;
  const normalized = normalizeContactInput(fields);
  assertValidContact(normalized);
  await assertActiveSource(client, context, normalized.sourceId);
  const account = accountId ? await loadLinkableAccount(client, context, accountId) : null;
  const duplicates = await assertNoBlockingContactDuplicate(client, context, { ...normalized, accountId: account?.id }, { allowDuplicate, reason: duplicateReason ?? inputReason });
  onDuplicateCheck?.(duplicates);

  // The owner defaults to the account's owner, else the creator.
  let ownerUserId = account?.owner_user_id || context.userId;
  if (has(input, "ownerUserId")) {
    ownerUserId = requestedOwner || null;
    if (ownerUserId && ownerUserId !== context.userId) {
      requireContactPermission(context, CONTACT_PERMISSIONS.assign, "You do not have permission to assign contacts.");
      await assertCrmOwnerAssignable(client, context, ownerUserId, "You can only assign contacts to yourself or to members of a team you manage.");
    }
  }

  const contactNumber = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: CONTACT_NUMBER_DOCUMENT_TYPE });
  const record = { ...normalized, displayName: normalized.displayName || composeDisplayName(normalized) };
  const columns = ["organization_id", "contact_number", "status", "created_by", "updated_by"];
  const values = [context.organizationId, contactNumber, "active", context.userId ?? null, context.userId ?? null];
  for (const [field, column] of Object.entries(CONTACT_WRITABLE_COLUMNS))
    if (has(record, field) && record[field] !== null) { columns.push(column); values.push(record[field]); }
  for (const [field, [column]] of Object.entries(ROLE_FIELDS))
    if (has(record, field) && record[field] !== null) { columns.push(column); values.push(record[field]); }
  const inserted = await client.query(
    `INSERT INTO tenant.contacts (${columns.join(", ")}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(", ")}) RETURNING *`,
    values,
  );
  const contact = inserted.rows[0];
  await recordDuplicateOverride(client, context, "contact", contact.id, duplicates);
  await recordContactHistory(client, context, contact.id, "created", historySummary ?? `Contact ${contactNumber} created`, {
    origin,
    ...(duplicates.hasBlockingMatch ? { duplicateConfirmed: duplicates.matches.filter((match) => match.strength === "exact").map((match) => match.id) } : {}),
  });
  if (account) {
    if (makePrimary)
      await client.query(`UPDATE tenant.crm_contact_account_relationships SET is_primary_contact = false WHERE organization_id = $1 AND party_id = $2 AND is_primary_contact`,
        [context.organizationId, account.id]);
    await client.query(
      `INSERT INTO tenant.crm_contact_account_relationships (organization_id, contact_id, party_id, job_title, department, role, is_primary_account, is_primary_contact,
                                                             is_decision_maker, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $9)`,
      [context.organizationId, contact.id, account.id, record.jobTitle ?? null, record.department ?? null, record.role ?? null, makePrimary === true,
        record.isDecisionMaker === true, context.userId ?? null],
    );
    await recordContactHistory(client, context, contact.id, "account_linked", `Linked to ${account.display_name}`, { accountId: account.id });
    await recordAccountHistory(client, context, account.id, "contact_linked", `Contact ${record.displayName} added`, { contactId: contact.id });
    if (makePrimary) await recordAccountHistory(client, context, account.id, "primary_contact_changed", `Primary contact: ${record.displayName}`, { contactId: contact.id });
  }
  await applyContactAssignment(client, context, contact, { ownerUserId, teamId: teamId || null }, { reason: origin, notify: origin !== "lead_conversion" });
  if (tagIds !== undefined) await setContactTags(client, context, contact.id, tagIds);
  await queueOutboxEvent(client, context, "crm.contacts.created", "contact", contact.id, { contactId: contact.id, accountId: account?.id ?? null });
  return projectContactForContext(context, toContact(await loadContactRow(client, context, contact.id, { skipScope: true })));
}

// ------------------------------------------------------------------ update

export async function updateContact(client, context, contactId, input = {}, { allowDuplicate = false, expectedUpdatedAt = null } = {}) {
  requireContactPermission(context, CONTACT_PERMISSIONS.edit, "You do not have permission to edit contacts.");
  const row = await loadContactRow(client, context, contactId, { lock: true });
  if (row.status === "archived") throw new CrmError(409, "Reactivate this contact before changing it.", "CRM_CONTACT_ARCHIVED");
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== new Date(row.updated_at).getTime())
    throw new CrmError(409, "This contact was changed by someone else. Reload it and try again.", "CRM_CONTACT_VERSION_CONFLICT");
  const before = toContact(row);
  const { tagIds, ...fields } = input;
  const normalized = normalizeContactInput(fields);
  // Contact details hidden from the caller cannot be changed by them.
  if (!contactCan(context, CONTACT_PERMISSIONS.viewSensitive))
    for (const field of ["email", "secondaryEmail", "phone", "mobile", "alternatePhone"])
      if (has(normalized, field)) throw new CrmError(403, "You do not have permission to change contact details.", "PERMISSION_DENIED");
  assertValidContact(normalized, before);
  if (has(normalized, "sourceId") && normalized.sourceId !== before.sourceId) await assertActiveSource(client, context, normalized.sourceId);

  const differs = (field) => String(normalized[field] ?? "") !== String(before[field] ?? "");
  const changedColumns = Object.keys(CONTACT_WRITABLE_COLUMNS).filter((field) => has(normalized, field) && differs(field));
  const changedRole = Object.keys(ROLE_FIELDS).filter((field) => has(normalized, field) && differs(field));
  // A name change keeps an automatic display name in step.
  if (!has(normalized, "displayName") && ["firstName", "middleName", "lastName"].some((field) => changedColumns.includes(field))
      && before.displayName === composeDisplayName(before)) {
    normalized.displayName = composeDisplayName({ ...before, ...normalized });
    if (normalized.displayName !== before.displayName) changedColumns.push("displayName");
  }
  // Only the values being changed are checked: a person already confirmed as
  // different from a look-alike is not blocked again on every later edit.
  const changedIdentity = changedColumns.filter((field) => IDENTITY_FIELDS.includes(field));
  if (changedIdentity.length) {
    const probe = Object.fromEntries(changedIdentity.map((field) => [field, normalized[field]]));
    if (probe.firstName !== undefined || probe.lastName !== undefined)
      Object.assign(probe, { firstName: normalized.firstName ?? before.firstName, lastName: normalized.lastName ?? before.lastName, accountId: before.accountId });
    await recordDuplicateOverride(client, context, "contact", row.id,
      await assertNoBlockingContactDuplicate(client, context, probe, { excludeId: row.id, allowDuplicate, reason: input.duplicateReason }));
  }

  if (changedColumns.length)
    await client.query(
      `UPDATE tenant.contacts SET ${changedColumns.map((field, index) => `${CONTACT_WRITABLE_COLUMNS[field]} = $${index + 3}`).join(", ")}, updated_by = $${changedColumns.length + 3}, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, ...changedColumns.map((field) => normalized[field]), context.userId ?? null],
    );
  if (changedRole.length) {
    // At a company the position belongs to that relationship; without one, to the person.
    if (row.party_id)
      await client.query(
        `UPDATE tenant.crm_contact_account_relationships SET ${changedRole.map((field, index) => `${ROLE_FIELDS[field][1]} = $${index + 3}`).join(", ")}, updated_by = $${changedRole.length + 3}
          WHERE organization_id = $1 AND contact_id = $2 AND is_primary_account`,
        [context.organizationId, row.id, ...changedRole.map((field) => normalized[field]), context.userId ?? null],
      );
    else
      await client.query(
        `UPDATE tenant.contacts SET ${changedRole.map((field, index) => `${ROLE_FIELDS[field][0]} = $${index + 3}`).join(", ")}, updated_at = now() WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, row.id, ...changedRole.map((field) => normalized[field])],
      );
    await client.query(`UPDATE tenant.contacts SET updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, context.userId ?? null]);
  }
  const changed = [...changedColumns, ...changedRole];
  if (changed.length) {
    const changes = Object.fromEntries(changed.map((field) => [field, { from: before[field] ?? null, to: normalized[field] ?? null }]));
    await recordContactHistory(client, context, row.id, "updated", `Updated ${changed.length === 1 ? changed[0] : `${changed.length} fields`}`, changes);
    await queueOutboxEvent(client, context, "crm.contacts.updated", "contact", row.id, { contactId: row.id, changedFields: changed });
  }
  if (tagIds !== undefined) await setContactTags(client, context, row.id, tagIds);
  return projectContactForContext(context, toContact(await loadContactRow(client, context, row.id)));
}

// ------------------------------------------------------------------ status

const STATUS_EVENTS = Object.freeze({ active: "reactivated", inactive: "deactivated", archived: "archived" });

// active -> inactive (deactivate), inactive/archived -> active (reactivate),
// any -> archived (archive). Nothing is deleted: activities, quotations,
// opportunities and tickets keep pointing at the person.
export async function setContactStatus(client, context, contactId, status, { note = null } = {}) {
  requireContactPermission(context, CONTACT_PERMISSIONS.archive, "You do not have permission to change the status of contacts.");
  if (!STATUS_EVENTS[status]) throw new CrmError(400, "Choose a status.", "CRM_CONTACT_STATUS_INVALID");
  const row = await loadContactRow(client, context, contactId, { lock: true });
  if (row.status === status) return { changed: false };
  await client.query(
    `UPDATE tenant.contacts SET status = $3, archived_at = CASE WHEN $3 = 'archived' THEN now() ELSE NULL END,
            archived_by = CASE WHEN $3 = 'archived' THEN $4::uuid ELSE NULL END, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, status, context.userId ?? null],
  );
  await recordContactHistory(client, context, row.id, STATUS_EVENTS[status], `Status: ${contactStatusLabel(row.status)} → ${contactStatusLabel(status)}`, {
    from: row.status, to: status, note: String(note ?? "").trim().slice(0, 500) || null,
  });
  return { changed: true };
}

export const deactivateContact = (client, context, contactId, input = {}) => setContactStatus(client, context, contactId, "inactive", input);
export const reactivateContact = (client, context, contactId, input = {}) => setContactStatus(client, context, contactId, "active", input);
export const archiveContact = (client, context, contactId, input = {}) => setContactStatus(client, context, contactId, "archived", input);

// Each contact succeeds or fails on its own.
export async function runContactBulkOperation(client, contactIds, operation) {
  const ids = [...new Set(Array.isArray(contactIds) ? contactIds : [])];
  if (!ids.length) throw new CrmError(400, "Select at least one contact.", "CRM_CONTACT_VALIDATION");
  if (ids.length > BULK_LIMIT) throw new CrmError(400, `Select up to ${BULK_LIMIT} contacts at a time.`, "CRM_CONTACT_BULK_LIMIT");
  const results = [];
  for (const contactId of ids) {
    await client.query("SAVEPOINT contact_bulk_operation");
    try {
      const outcome = await operation(contactId);
      await client.query("RELEASE SAVEPOINT contact_bulk_operation");
      results.push({ contactId, ok: true, changed: outcome?.changed ?? true });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT contact_bulk_operation");
      if (!(error instanceof CrmError)) throw error;
      results.push({ contactId, ok: false, message: error.message });
    }
  }
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}

export async function bulkSetContactStatus(client, context, input = {}) {
  return runContactBulkOperation(client, input.contactIds, (contactId) => setContactStatus(client, context, contactId, input.status));
}

// ------------------------------------------------------------------ delete unused

// Anything that makes the person part of the business record. Any of these
// blocks deletion: such a contact is deactivated or archived instead.
const REFERENCES = Object.freeze([
  ["opportunities", "SELECT 1 FROM tenant.crm_opportunities WHERE organization_id = $1 AND contact_id = $2"],
  ["opportunity roles", "SELECT 1 FROM tenant.crm_opportunity_contact_roles WHERE organization_id = $1 AND contact_id = $2"],
  ["converted leads", "SELECT 1 FROM tenant.crm_leads WHERE organization_id = $1 AND converted_contact_id = $2"],
  ["activities", "SELECT 1 FROM tenant.crm_activities WHERE organization_id = $1 AND ((entity_type = 'contact' AND entity_id = $2) OR related_contact_id = $2)"],
  ["communications", "SELECT 1 FROM tenant.crm_communications WHERE organization_id = $1 AND contact_id = $2"],
  ["quotations", "SELECT 1 FROM tenant.sales_quotations WHERE organization_id = $1 AND contact_id = $2"],
  ["sales orders", "SELECT 1 FROM tenant.sales_orders WHERE organization_id = $1 AND contact_id = $2"],
  ["support tickets", "SELECT 1 FROM tenant.support_tickets WHERE organization_id = $1 AND contact_id = $2"],
]);

export async function contactReferences(client, context, contactId) {
  const found = [];
  for (const [label, sql] of REFERENCES) {
    const { rows } = await client.query(`${sql} LIMIT 1`, [context.organizationId, contactId]);
    if (rows[0]) found.push(label);
  }
  return found;
}

// Permanently removes a contact created by mistake. Company links, tags and
// notes go with it; anything that makes it part of the business record blocks it.
export async function deleteUnusedContact(client, context, contactId) {
  requireContactPermission(context, CONTACT_PERMISSIONS.delete, "You do not have permission to delete contacts.");
  const row = await loadContactRow(client, context, contactId, { lock: true });
  const references = await contactReferences(client, context, row.id);
  if (references.length)
    throw new CrmError(409, `This contact has ${references.join(", ")}. Archive it instead of deleting it.`, "CRM_CONTACT_IN_USE", { references });
  await client.query(`DELETE FROM tenant.crm_notes WHERE organization_id = $1 AND entity_type = 'contact' AND entity_id = $2`, [context.organizationId, row.id]);
  await client.query(`DELETE FROM tenant.contacts WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  await queueOutboxEvent(client, context, "crm.contacts.archived", "contact", row.id, { contactId: row.id, deleted: true });
  return { deleted: true };
}
