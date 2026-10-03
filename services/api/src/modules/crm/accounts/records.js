// The account record: create, read, list, update, status changes and
// deletion of unused accounts. Owner and team change only through
// assignment.js; the parent through hierarchy.js; the customer link through
// customer.js.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { assertCrmOwnerAssignable } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { managedTeamMembersSql } from "../data-management/record-utils.js";
import { accountCan, accountCapabilities, accountScopeSql, projectAccountForContext, requireAccountPermission } from "./access.js";
import { applyAccountAssignment } from "./assignment.js";
import { ACCOUNT_NUMBER_DOCUMENT_TYPE, ACCOUNT_PERMISSIONS, CRM_ACCOUNT_PARTY_SQL, accountStatusLabel, accountTypeLabel } from "./constants.js";
import { assertNoBlockingAccountDuplicate } from "./duplicates.js";
import { recordAccountHistory } from "./history.js";
import { ACCOUNT_WRITABLE_COLUMNS, assertValidAccount, isUuid, normalizeAccountInput, requireUuid } from "./validation.js";

const BULK_LIMIT = 200;
const DUPLICATE_IDENTITY_FIELDS = ["displayName", "legalName", "website", "email", "phone"];
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const ACCOUNT_SELECT = `
  SELECT account.*, owner.full_name AS owner_name, team.name AS team_name, source.name AS source_name, parent.display_name AS parent_name,
         creator.full_name AS created_by_name, updater.full_name AS updated_by_name,
         address.city AS address_city, address.state AS address_state, address.country_code AS address_country_code,
         follow_up.next_follow_up_at,
         pipeline.open_opportunities, pipeline.open_pipeline_value,
         (SELECT count(*) FROM tenant.contacts contact WHERE contact.organization_id = account.organization_id AND contact.party_id = account.id AND contact.status = 'active')::int AS contact_count,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', tag.id, 'name', tag.name, 'color', tag.color) ORDER BY tag.name)
                     FROM tenant.crm_account_tags account_tag
                     JOIN tenant.crm_tags tag ON tag.organization_id = account_tag.organization_id AND tag.id = account_tag.tag_id
                    WHERE account_tag.organization_id = account.organization_id AND account_tag.party_id = account.id), '[]'::jsonb) AS tags
    FROM tenant.business_parties account
    LEFT JOIN public.users owner ON owner.id = account.owner_user_id
    LEFT JOIN public.users creator ON creator.id = account.created_by
    LEFT JOIN public.users updater ON updater.id = account.updated_by
    LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = account.organization_id AND team.id = account.team_id
    LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = account.organization_id AND source.id = account.source_id
    LEFT JOIN tenant.business_parties parent ON parent.organization_id = account.organization_id AND parent.id = account.parent_party_id
    LEFT JOIN LATERAL (
      SELECT a.city, a.state, a.country_code FROM tenant.addresses a
       WHERE a.organization_id = account.organization_id AND a.party_id = account.id AND a.status = 'active'
       ORDER BY a.is_default_billing DESC, a.is_primary DESC, a.created_at LIMIT 1) address ON true
    LEFT JOIN LATERAL (
      SELECT min(activity.due_at) AS next_follow_up_at FROM tenant.crm_activities activity
       WHERE activity.organization_id = account.organization_id AND activity.entity_type = 'party' AND activity.entity_id = account.id
         AND activity.activity_type = 'follow_up' AND activity.status IN ('planned', 'in_progress', 'overdue')) follow_up ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS open_opportunities, COALESCE(sum(opportunity.amount), 0) AS open_pipeline_value
        FROM tenant.crm_opportunities opportunity
       WHERE opportunity.organization_id = account.organization_id AND opportunity.party_id = account.id AND opportunity.status = 'open') pipeline ON true`;

export function toAccount(row) {
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    legalName: row.legal_name,
    accountType: row.account_type,
    status: row.status,
    partyType: row.party_type,
    industry: row.industry,
    website: row.website,
    email: row.email,
    phone: row.phone,
    secondaryPhone: row.secondary_phone,
    employeeRange: row.employee_range,
    annualRevenue: row.annual_revenue === null || row.annual_revenue === undefined ? null : Number(row.annual_revenue),
    currencyCode: row.currency_code?.trim() ?? null,
    description: row.description,
    tags: row.tags ?? [],
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name ?? null,
    teamId: row.team_id,
    teamName: row.team_name ?? null,
    assignedAt: row.assigned_at,
    sourceId: row.source_id,
    sourceName: row.source_name ?? null,
    sourceDetail: row.source_detail,
    parentPartyId: row.parent_party_id,
    parentName: row.parent_name ?? null,
    customerNumber: row.customer_number,
    customerSince: row.customer_since,
    isCustomer: Boolean(row.customer_number) || ["customer", "both"].includes(row.party_type),
    city: row.address_city ?? null,
    state: row.address_state ?? null,
    countryCode: row.address_country_code?.trim() ?? null,
    contactCount: row.contact_count ?? 0,
    openOpportunities: row.open_opportunities ?? 0,
    openPipelineValue: Number(row.open_pipeline_value ?? 0),
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

async function loadAccountRow(client, context, partyId, { lock = false, skipScope = false } = {}) {
  const values = [context.organizationId, requireUuid(partyId, "Account")];
  const scope = skipScope ? "" : accountScopeSql(context, values, "account");
  const { rows } = await client.query(
    `${ACCOUNT_SELECT} WHERE account.organization_id = $1 AND account.id = $2 AND ${CRM_ACCOUNT_PARTY_SQL("account")}${scope}${lock ? " FOR UPDATE OF account" : ""}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Account not found.", "CRM_ACCOUNT_NOT_FOUND");
  return rows[0];
}

export async function lockAccount(client, context, partyId, options = {}) {
  return loadAccountRow(client, context, partyId, { ...options, lock: true });
}

export async function getAccount(client, context, partyId) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.view, "You do not have permission to view accounts.");
  return projectAccountForContext(context, toAccount(await loadAccountRow(client, context, partyId)));
}

// ------------------------------------------------------------------ list

export const ACCOUNT_VIEWS = Object.freeze([
  { key: "all", label: "All Accounts" },
  { key: "mine", label: "My Accounts" },
  { key: "team", label: "Team Accounts" },
  { key: "prospects", label: "Prospects" },
  { key: "customers", label: "Customers" },
  { key: "active", label: "Active Accounts" },
  { key: "inactive", label: "Inactive Accounts" },
  { key: "recently_created", label: "Recently Created" },
  { key: "recently_updated", label: "Recently Updated" },
  { key: "archived", label: "Archived" },
]);

const SORT_COLUMNS = Object.freeze({
  code: "account.code",
  displayName: "lower(account.display_name)",
  accountType: "account.account_type",
  status: "account.status",
  industry: "lower(account.industry)",
  ownerName: "lower(owner.full_name)",
  sourceName: "lower(source.name)",
  city: "lower(address.city)",
  openPipelineValue: "pipeline.open_pipeline_value",
  lastActivityAt: "account.last_activity_at",
  nextFollowUpAt: "follow_up.next_follow_up_at",
  createdAt: "account.created_at",
  updatedAt: "account.updated_at",
});
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The WHERE clause shared by the list, the export, the report and the bulk
// operations, so "what I see" and "what I export" can never differ.
export function buildAccountListWhere(context, filters = {}, values = []) {
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = [`account.organization_id = ${bind(context.organizationId)}`, CRM_ACCOUNT_PARTY_SQL("account")];
  const view = filters.view || "all";
  if (view === "archived") where.push("account.status = 'archived'");
  else if (view === "inactive") where.push("account.status = 'inactive'");
  else if (view === "active") where.push("account.status = 'active'");
  else if (!filters.status) where.push("account.status <> 'archived'");
  if (view === "mine") where.push(`account.owner_user_id = ${bind(context.userId)}`);
  if (view === "team") {
    const me = bind(context.userId);
    where.push(`(account.owner_user_id IN (${managedTeamMembersSql("account.organization_id", me)})
      OR account.team_id IN (SELECT team.id FROM tenant.crm_sales_teams team WHERE team.organization_id = account.organization_id AND team.status = 'active'
        AND (team.manager_user_id = ${me} OR EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member
              WHERE member.organization_id = team.organization_id AND member.team_id = team.id AND member.user_id = ${me} AND member.status = 'active'))))`);
  }
  if (view === "prospects") where.push("account.account_type = 'prospect'");
  if (view === "customers") where.push("account.account_type = 'customer'");
  if (view === "recently_created") where.push("account.created_at >= now() - interval '30 days'");
  if (view === "recently_updated") where.push("account.updated_at >= now() - interval '30 days'");

  if (filters.accountType) where.push(`account.account_type = ${bind(String(filters.accountType))}`);
  if (filters.status) where.push(`account.status = ${bind(String(filters.status))}`);
  if (filters.industry) where.push(`lower(account.industry) = lower(${bind(String(filters.industry))})`);
  if (isUuid(filters.sourceId)) where.push(`account.source_id = ${bind(filters.sourceId)}`);
  if (isUuid(filters.teamId)) where.push(`account.team_id = ${bind(filters.teamId)}`);
  if (filters.ownerId === "unassigned") where.push("account.owner_user_id IS NULL");
  else if (filters.ownerId === "me") where.push(`account.owner_user_id = ${bind(context.userId)}`);
  else if (isUuid(filters.ownerId)) where.push(`account.owner_user_id = ${bind(filters.ownerId)}`);
  if (filters.countryCode || filters.state) {
    const conditions = ["a.organization_id = account.organization_id", "a.party_id = account.id", "a.status = 'active'"];
    if (filters.countryCode) conditions.push(`a.country_code = ${bind(String(filters.countryCode).toUpperCase())}`);
    if (filters.state) conditions.push(`lower(a.state) = lower(${bind(String(filters.state))})`);
    where.push(`EXISTS (SELECT 1 FROM tenant.addresses a WHERE ${conditions.join(" AND ")})`);
  }
  if (DATE.test(String(filters.createdFrom ?? ""))) where.push(`account.created_at >= ${bind(filters.createdFrom)}::date`);
  if (DATE.test(String(filters.createdTo ?? ""))) where.push(`account.created_at < ${bind(filters.createdTo)}::date + interval '1 day'`);
  // "No activity since" a date (includes accounts never contacted)
  if (DATE.test(String(filters.lastActivityBefore ?? ""))) where.push(`(account.last_activity_at IS NULL OR account.last_activity_at < ${bind(filters.lastActivityBefore)}::date)`);
  if (filters.hasOpenOpportunity === "yes" || filters.hasOpenOpportunity === "no")
    where.push(`${filters.hasOpenOpportunity === "no" ? "NOT " : ""}EXISTS (SELECT 1 FROM tenant.crm_opportunities o WHERE o.organization_id = account.organization_id AND o.party_id = account.id AND o.status = 'open')`);
  if (filters.isCustomer === "yes") where.push("(account.customer_number IS NOT NULL OR account.party_type IN ('customer', 'both'))");
  if (filters.isCustomer === "no") where.push("account.customer_number IS NULL AND account.party_type NOT IN ('customer', 'both')");
  if (isUuid(filters.tagId))
    where.push(`EXISTS (SELECT 1 FROM tenant.crm_account_tags t WHERE t.organization_id = account.organization_id AND t.party_id = account.id AND t.tag_id = ${bind(filters.tagId)})`);
  if (Array.isArray(filters.ids) && filters.ids.length) where.push(`account.id = ANY (${bind(filters.ids.filter(isUuid))}::uuid[])`);

  const search = String(filters.search ?? "").trim().toLowerCase();
  if (search) {
    const pattern = bind(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    const contactDetails = accountCan(context, ACCOUNT_PERMISSIONS.viewSensitive)
      ? "|| ' ' || COALESCE(account.email, '') || ' ' || COALESCE(account.phone, '') || ' ' || COALESCE(account.secondary_phone, '')" : "";
    where.push(`(lower(COALESCE(account.code, '') || ' ' || COALESCE(account.display_name, '') || ' ' || COALESCE(account.legal_name, '') || ' '
        || COALESCE(account.website, '') || ' ' || COALESCE(account.customer_number, '') || ' ' || COALESCE(account.gstin, '') ${contactDetails}) LIKE ${pattern}
      OR EXISTS (SELECT 1 FROM tenant.contacts contact WHERE contact.organization_id = account.organization_id AND contact.party_id = account.id
                  AND lower(contact.first_name || ' ' || COALESCE(contact.last_name, '')) LIKE ${pattern}))`);
  }
  return `WHERE ${where.join(" AND ")}${accountScopeSql(context, values, "account")}`;
}

export async function listAccounts(client, context, filters = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.view, "You do not have permission to view accounts.");
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const view = filters.view || "all";
  const defaultSort = view === "recently_created" ? "createdAt" : "updatedAt";
  const sortColumn = SORT_COLUMNS[filters.sortBy] ?? SORT_COLUMNS[defaultSort];
  const sortDirection = String(filters.sortDirection).toLowerCase() === "asc" ? "ASC" : "DESC";
  const values = [];
  const where = buildAccountListWhere(context, filters, values);
  const total = await client.query(`SELECT count(*)::int AS total FROM tenant.business_parties account ${where}`, values);
  const { rows } = await client.query(`${ACCOUNT_SELECT} ${where} ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, account.id DESC LIMIT ${limit} OFFSET ${offset}`, values);
  return {
    accounts: rows.map((row) => projectAccountForContext(context, toAccount(row))),
    total: total.rows[0].total,
    limit,
    offset,
    capabilities: accountCapabilities(context),
  };
}

// ------------------------------------------------------------------ create

export async function setAccountTags(client, context, partyId, tagIds) {
  const ids = [...new Set((Array.isArray(tagIds) ? tagIds : []).filter(isUuid))];
  await client.query(`DELETE FROM tenant.crm_account_tags WHERE organization_id = $1 AND party_id = $2 AND NOT (tag_id = ANY ($3::uuid[]))`, [context.organizationId, partyId, ids]);
  if (!ids.length) return;
  await client.query(
    `INSERT INTO tenant.crm_account_tags (organization_id, party_id, tag_id, created_by)
     SELECT $1, $2, tag.id, $4 FROM tenant.crm_tags tag WHERE tag.organization_id = $1 AND tag.id = ANY ($3::uuid[]) AND tag.status = 'active'
     ON CONFLICT DO NOTHING`,
    [context.organizationId, partyId, ids, context.userId ?? null],
  );
}

async function assertActiveSource(client, context, sourceId) {
  if (!sourceId) return;
  const { rows } = await client.query(`SELECT status FROM tenant.crm_lead_sources WHERE organization_id = $1 AND id = $2`, [context.organizationId, requireUuid(sourceId, "Source")]);
  if (!rows[0]) throw new CrmError(400, "Choose a source from the list.", "CRM_ACCOUNT_SOURCE_INVALID");
  if (rows[0].status !== "active") throw new CrmError(409, "This source is no longer active. Choose another.", "CRM_ACCOUNT_SOURCE_INACTIVE");
}

// options:
//   allowDuplicate  the caller confirmed a strong duplicate is a different company
//   origin          recorded in history: "manual" | "import" | "lead_conversion"
//   historySummary  overrides the created event's summary
export async function createAccount(client, context, input = {}, { allowDuplicate = false, origin = "manual", historySummary = null } = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.create, "You do not have permission to create accounts.");
  // Owner, team and tags are set below through their own rules.
  const { ownerUserId: _owner, teamId: _team, tagIds: _tags, ...accountFields } = input;
  const normalized = normalizeAccountInput(accountFields);
  if (!normalized.accountType) normalized.accountType = "prospect";
  // A customer account comes into being through Create customer, which gives
  // it its Customer Master; a new record starts as a prospect, partner or other.
  if (normalized.accountType === "customer")
    throw new CrmError(409, "Create the account as a prospect, then use Create customer.", "CRM_ACCOUNT_TYPE_GOVERNED");
  assertValidAccount(normalized);
  await assertActiveSource(client, context, normalized.sourceId);
  const duplicates = await assertNoBlockingAccountDuplicate(client, context, normalized, { allowDuplicate });

  let ownerUserId = context.userId;
  if (has(input, "ownerUserId")) {
    ownerUserId = input.ownerUserId || null;
    if (ownerUserId && ownerUserId !== context.userId) {
      requireAccountPermission(context, ACCOUNT_PERMISSIONS.assign, "You do not have permission to assign accounts.");
      await assertCrmOwnerAssignable(client, context, ownerUserId, "You can only assign accounts to yourself or to members of a team you manage.");
    }
  }

  const code = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: ACCOUNT_NUMBER_DOCUMENT_TYPE });
  const fields = Object.keys(normalized).filter((field) => ACCOUNT_WRITABLE_COLUMNS[field] && normalized[field] !== null);
  const columns = ["organization_id", "code", "party_type", "status", "created_by", "updated_by", ...fields.map((field) => ACCOUNT_WRITABLE_COLUMNS[field])];
  const values = [context.organizationId, code, "prospect", "active", context.userId ?? null, context.userId ?? null, ...fields.map((field) => normalized[field])];
  const inserted = await client.query(
    `INSERT INTO tenant.business_parties (${columns.join(", ")}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(", ")}) RETURNING *`,
    values,
  );
  const account = inserted.rows[0];
  await recordAccountHistory(client, context, account.id, "created", historySummary ?? `Account ${code} created`, {
    origin,
    ...(duplicates.hasBlockingMatch ? { duplicateConfirmed: duplicates.matches.filter((match) => match.strength === "exact").map((match) => match.id) } : {}),
  });
  await applyAccountAssignment(client, context, account, { ownerUserId, teamId: input.teamId || null }, { reason: origin });
  if (has(input, "tagIds")) await setAccountTags(client, context, account.id, input.tagIds);
  await queueOutboxEvent(client, context, "crm.accounts.created", "account", account.id, { accountId: account.id });
  return projectAccountForContext(context, toAccount(await loadAccountRow(client, context, account.id, { skipScope: true })));
}

// ------------------------------------------------------------------ update

export async function updateAccount(client, context, partyId, input = {}, { allowDuplicate = false, expectedUpdatedAt = null } = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit accounts.");
  const row = await loadAccountRow(client, context, partyId, { lock: true });
  if (row.status === "archived") throw new CrmError(409, "Reactivate this account before changing it.", "CRM_ACCOUNT_ARCHIVED");
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== new Date(row.updated_at).getTime())
    throw new CrmError(409, "This account was changed by someone else. Reload it and try again.", "CRM_ACCOUNT_VERSION_CONFLICT");
  const before = toAccount(row);
  const normalized = normalizeAccountInput(input);
  // Customer status follows the Customer Master, not a dropdown.
  if (has(normalized, "accountType") && normalized.accountType !== before.accountType && (normalized.accountType === "customer" || before.accountType === "customer"))
    throw new CrmError(409, before.isCustomer ? "This account is a customer; its type follows its Customer Master." : "Use Create customer to make this account a customer.", "CRM_ACCOUNT_TYPE_GOVERNED");
  assertValidAccount(normalized, before);
  if (has(normalized, "sourceId") && normalized.sourceId !== before.sourceId) await assertActiveSource(client, context, normalized.sourceId);

  const changed = Object.keys(normalized).filter((field) => ACCOUNT_WRITABLE_COLUMNS[field] && String(normalized[field] ?? "") !== String(before[field] ?? ""));
  if (changed.some((field) => DUPLICATE_IDENTITY_FIELDS.includes(field)))
    await assertNoBlockingAccountDuplicate(client, context, { ...before, ...normalized }, { excludeId: row.id, allowDuplicate });
  if (changed.length) {
    await client.query(
      `UPDATE tenant.business_parties SET ${changed.map((field, index) => `${ACCOUNT_WRITABLE_COLUMNS[field]} = $${index + 3}`).join(", ")}, updated_by = $${changed.length + 3}, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, ...changed.map((field) => normalized[field]), context.userId ?? null],
    );
    const changes = Object.fromEntries(changed.map((field) => [field, { from: before[field] ?? null, to: normalized[field] ?? null }]));
    if (changed.includes("accountType"))
      await recordAccountHistory(client, context, row.id, "type_changed", `Type: ${accountTypeLabel(before.accountType)} → ${accountTypeLabel(normalized.accountType)}`, changes.accountType);
    const others = changed.filter((field) => field !== "accountType");
    if (others.length)
      await recordAccountHistory(client, context, row.id, "updated", `Updated ${others.length === 1 ? others[0] : `${others.length} fields`}`,
        Object.fromEntries(others.map((field) => [field, changes[field]])));
    await queueOutboxEvent(client, context, "crm.accounts.updated", "account", row.id, { accountId: row.id, changedFields: changed });
  }
  if (has(input, "tagIds")) await setAccountTags(client, context, row.id, input.tagIds);
  return projectAccountForContext(context, toAccount(await loadAccountRow(client, context, row.id)));
}

// ------------------------------------------------------------------ status

const STATUS_EVENTS = Object.freeze({ active: "reactivated", inactive: "deactivated", archived: "archived" });

// active -> inactive (deactivate), inactive/archived -> active (reactivate),
// any -> archived (archive). Nothing is deleted.
export async function setAccountStatus(client, context, partyId, status, { note = null } = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.archive, "You do not have permission to change the status of accounts.");
  if (!STATUS_EVENTS[status]) throw new CrmError(400, "Choose a status.", "CRM_ACCOUNT_STATUS_INVALID");
  const row = await loadAccountRow(client, context, partyId, { lock: true });
  if (row.status === status) return { changed: false };
  await client.query(
    `UPDATE tenant.business_parties SET status = $3, archived_at = CASE WHEN $3 = 'archived' THEN now() ELSE NULL END,
            archived_by = CASE WHEN $3 = 'archived' THEN $4::uuid ELSE NULL END, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, status, context.userId ?? null],
  );
  await recordAccountHistory(client, context, row.id, STATUS_EVENTS[status], `Status: ${accountStatusLabel(row.status)} → ${accountStatusLabel(status)}`, {
    from: row.status, to: status, note: String(note ?? "").trim().slice(0, 500) || null,
  });
  return { changed: true };
}

export const deactivateAccount = (client, context, partyId, input = {}) => setAccountStatus(client, context, partyId, "inactive", input);
export const reactivateAccount = (client, context, partyId, input = {}) => setAccountStatus(client, context, partyId, "active", input);
export const archiveAccount = (client, context, partyId, input = {}) => setAccountStatus(client, context, partyId, "archived", input);

// Each account succeeds or fails on its own.
export async function runAccountBulkOperation(client, partyIds, operation) {
  const ids = [...new Set(Array.isArray(partyIds) ? partyIds : [])];
  if (!ids.length) throw new CrmError(400, "Select at least one account.", "CRM_ACCOUNT_VALIDATION");
  if (ids.length > BULK_LIMIT) throw new CrmError(400, `Select up to ${BULK_LIMIT} accounts at a time.`, "CRM_ACCOUNT_BULK_LIMIT");
  const results = [];
  for (const partyId of ids) {
    await client.query("SAVEPOINT account_bulk_operation");
    try {
      const outcome = await operation(partyId);
      await client.query("RELEASE SAVEPOINT account_bulk_operation");
      results.push({ partyId, ok: true, changed: outcome?.changed ?? true });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT account_bulk_operation");
      if (!(error instanceof CrmError)) throw error;
      results.push({ partyId, ok: false, message: error.message });
    }
  }
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}

export async function bulkSetAccountStatus(client, context, input = {}) {
  return runAccountBulkOperation(client, input.partyIds, (partyId) => setAccountStatus(client, context, partyId, input.status));
}

// ------------------------------------------------------------------ delete unused

// Everything that can refer to an account. Any reference blocks deletion:
// such an account is deactivated or archived instead.
const REFERENCES = Object.freeze([
  ["contacts", "SELECT 1 FROM tenant.contacts WHERE organization_id = $1 AND party_id = $2"],
  ["opportunities", "SELECT 1 FROM tenant.crm_opportunities WHERE organization_id = $1 AND party_id = $2"],
  ["converted leads", "SELECT 1 FROM tenant.crm_leads WHERE organization_id = $1 AND converted_party_id = $2"],
  ["child accounts", "SELECT 1 FROM tenant.business_parties WHERE organization_id = $1 AND parent_party_id = $2"],
  ["activities", "SELECT 1 FROM tenant.crm_activities WHERE organization_id = $1 AND entity_type = 'party' AND entity_id = $2"],
  ["quotations", "SELECT 1 FROM tenant.sales_quotations WHERE organization_id = $1 AND party_id = $2"],
  ["sales orders", "SELECT 1 FROM tenant.sales_orders WHERE organization_id = $1 AND party_id = $2"],
  ["invoices", "SELECT 1 FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND party_id = $2"],
  ["payments", "SELECT 1 FROM tenant.accounting_customer_receipts WHERE organization_id = $1 AND party_id = $2"],
  ["supplier bills", "SELECT 1 FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND party_id = $2"],
  ["vendor payments", "SELECT 1 FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND party_id = $2"],
  ["journal entries", "SELECT 1 FROM tenant.accounting_journal_lines WHERE organization_id = $1 AND party_id = $2"],
  ["POS sales", "SELECT 1 FROM tenant.pos_sales WHERE organization_id = $1 AND customer_id = $2"],
  ["projects", "SELECT 1 FROM tenant.projects WHERE organization_id = $1 AND customer_id = $2"],
  ["support tickets", "SELECT 1 FROM tenant.support_tickets WHERE organization_id = $1 AND customer_id = $2"],
]);

export async function accountReferences(client, context, partyId) {
  const found = [];
  for (const [label, sql] of REFERENCES) {
    const { rows } = await client.query(`${sql} LIMIT 1`, [context.organizationId, partyId]);
    if (rows[0]) found.push(label);
  }
  return found;
}

// Permanently removes an account created by mistake. Only an account that
// nothing refers to, and that has never been a customer, can be deleted.
export async function deleteUnusedAccount(client, context, partyId) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.delete, "You do not have permission to delete accounts.");
  const row = await loadAccountRow(client, context, partyId, { lock: true });
  if (row.customer_number || ["customer", "both"].includes(row.party_type))
    throw new CrmError(409, "A customer account cannot be deleted. Archive it instead.", "CRM_ACCOUNT_IN_USE");
  const references = await accountReferences(client, context, row.id);
  if (references.length)
    throw new CrmError(409, `This account has ${references.join(", ")}. Archive it instead of deleting it.`, "CRM_ACCOUNT_IN_USE", { references });
  await client.query(`DELETE FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  await queueOutboxEvent(client, context, "crm.accounts.archived", "account", row.id, { accountId: row.id, deleted: true });
  return { deleted: true };
}
