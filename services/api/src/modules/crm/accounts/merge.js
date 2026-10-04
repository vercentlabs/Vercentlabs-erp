// Merging a duplicate account into the account that should be kept.
// The user chooses, field by field, which value survives; blank fields on the
// kept account are filled from the duplicate. Every CRM record of the
// duplicate (contacts, opportunities, leads, activities, notes, files,
// addresses, tags, child accounts, emails) moves to the kept account. The
// duplicate is archived — never deleted — and an alias remembers where it
// went, so old links still resolve.
//
// Accounting and sales documents are never rewritten: a duplicate that has
// quotations, orders, invoices, payments, projects or tickets cannot be
// merged, and neither can two customer accounts (merging two Customer
// Masters is a finance decision, not a CRM one).
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { requireAccountPermission } from "./access.js";
import { ACCOUNT_PERMISSIONS } from "./constants.js";
import { recordAccountHistory } from "./history.js";
import { getAccount, lockAccount, toAccount } from "./records.js";
import { requireUuid } from "./validation.js";

// field -> column. These are the choices offered on the merge screen.
export const MERGE_FIELDS = Object.freeze({
  displayName: "display_name",
  legalName: "legal_name",
  industry: "industry",
  website: "website",
  email: "email",
  phone: "phone",
  secondaryPhone: "secondary_phone",
  employeeRange: "employee_range",
  annualRevenue: "annual_revenue",
  description: "description",
  sourceId: "source_id",
  ownerUserId: "owner_user_id",
  teamId: "team_id",
});
// Filled from the duplicate only when the kept account has none.
const FILL_ONLY_COLUMNS = Object.freeze(["gstin", "pan", "source_detail", "currency_code"]);

const TRANSACTIONS = Object.freeze([
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

// What moves, counted for the preview.
const MOVABLE = Object.freeze([
  ["contacts", "SELECT count(*)::int AS n FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND party_id = $2"],
  ["opportunities", "SELECT count(*)::int AS n FROM tenant.crm_opportunities WHERE organization_id = $1 AND party_id = $2"],
  ["leads", "SELECT count(*)::int AS n FROM tenant.crm_leads WHERE organization_id = $1 AND converted_party_id = $2"],
  ["activities", "SELECT count(*)::int AS n FROM tenant.crm_activities WHERE organization_id = $1 AND entity_type = 'party' AND entity_id = $2"],
  ["notes", "SELECT count(*)::int AS n FROM tenant.crm_notes WHERE organization_id = $1 AND entity_type = 'party' AND entity_id = $2"],
  ["attachments", "SELECT count(*)::int AS n FROM public.attachments WHERE organization_id = $1 AND entity_type = 'crm.party' AND entity_id = $2::text"],
  ["addresses", "SELECT count(*)::int AS n FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active'"],
  ["child accounts", "SELECT count(*)::int AS n FROM tenant.business_parties WHERE organization_id = $1 AND parent_party_id = $2"],
]);

const isCustomer = (row) => Boolean(row.customer_number) || ["customer", "both"].includes(row.party_type);

async function transactionsOf(client, context, partyId) {
  const found = [];
  for (const [label, sql] of TRANSACTIONS) if ((await client.query(`${sql} LIMIT 1`, [context.organizationId, partyId])).rows[0]) found.push(label);
  return found;
}

function blockersFor(keep, duplicate, transactions) {
  const blockers = [];
  if (keep.status === "archived") blockers.push("The account to keep is archived. Reactivate it first.");
  if (duplicate.status === "archived") blockers.push("The duplicate is already archived.");
  if (isCustomer(keep) && isCustomer(duplicate)) blockers.push("Both accounts are customers. Customer Masters cannot be merged from CRM.");
  else if (isCustomer(duplicate)) blockers.push("The duplicate is a customer. Keep the customer account and merge the other one into it.");
  if (transactions.length) blockers.push(`The duplicate has ${transactions.join(", ")}. Accounts with sales or finance records cannot be merged away.`);
  return blockers;
}

function assertDistinct(keepId, duplicateId) {
  if (requireUuid(keepId, "Account") === requireUuid(duplicateId, "Account"))
    throw new CrmError(400, "Choose two different accounts to merge.", "CRM_ACCOUNT_MERGE_INVALID");
}

// Side-by-side view for the merge screen: both records, what will move, and
// anything that prevents the merge.
export async function previewAccountMerge(client, context, keepId, duplicateId) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.merge, "You do not have permission to merge accounts.");
  assertDistinct(keepId, duplicateId);
  const keep = await getAccount(client, context, keepId);
  const duplicate = await getAccount(client, context, duplicateId);
  const moves = {};
  for (const [label, sql] of MOVABLE) moves[label] = (await client.query(sql, [context.organizationId, duplicate.id])).rows[0].n;
  const transactions = await transactionsOf(client, context, duplicate.id);
  const rows = { keep: { ...keep, customer_number: keep.customerNumber, party_type: keep.partyType }, duplicate: { ...duplicate, customer_number: duplicate.customerNumber, party_type: duplicate.partyType } };
  return { keep, duplicate, fields: Object.keys(MERGE_FIELDS), moves, blockers: blockersFor(rows.keep, rows.duplicate, transactions) };
}

// input: { keepId, duplicateId, choices: { [field]: "keep" | "duplicate" } }
// A field with no choice keeps the kept account's value, or takes the
// duplicate's when the kept account has none.
// linkingCustomer: called by linkCustomer, which checks its own permission.
export async function mergeAccounts(client, context, input = {}, { linkingCustomer = false } = {}) {
  if (!linkingCustomer) requireAccountPermission(context, ACCOUNT_PERMISSIONS.merge, "You do not have permission to merge accounts.");
  const { keepId, duplicateId } = input;
  assertDistinct(keepId, duplicateId);
  // Lock in a stable order so two opposite merges cannot deadlock.
  const locked = {};
  for (const id of [keepId, duplicateId].sort()) locked[id] = await lockAccount(client, context, id);
  const keep = locked[keepId];
  const duplicate = locked[duplicateId];
  const blockers = blockersFor(keep, duplicate, await transactionsOf(client, context, duplicate.id));
  if (blockers.length) throw new CrmError(409, blockers[0], "CRM_ACCOUNT_MERGE_BLOCKED", { blockers });

  const organizationId = context.organizationId;
  const choices = input.choices && typeof input.choices === "object" ? input.choices : {};
  const blank = (value) => value === null || value === undefined || value === "";
  const updates = {};
  for (const [field, column] of Object.entries(MERGE_FIELDS)) {
    const takeDuplicate = choices[field] === "duplicate" || (choices[field] !== "keep" && blank(keep[column]));
    if (takeDuplicate && !blank(duplicate[column]) && String(duplicate[column]) !== String(keep[column] ?? "")) updates[column] = duplicate[column];
  }
  for (const column of FILL_ONLY_COLUMNS) if (blank(keep[column]) && !blank(duplicate[column])) updates[column] = duplicate[column];
  // The kept account keeps its parent, unless its parent was the duplicate.
  if (keep.parent_party_id === duplicate.id) updates.parent_party_id = duplicate.parent_party_id === keep.id ? null : duplicate.parent_party_id;

  // The duplicate is archived first so its identity no longer collides; a
  // GSTIN is unique per organization, so one that moves is released here.
  await client.query(
    `UPDATE tenant.business_parties SET status = 'archived', archived_at = now(), archived_by = $3, parent_party_id = NULL,
            gstin = CASE WHEN $4 THEN NULL ELSE gstin END, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, duplicate.id, context.userId ?? null, "gstin" in updates],
  );

  const move = [organizationId, duplicate.id, keep.id];
  // People move with their links. Someone linked to both keeps one link, and
  // the kept account keeps its own primary contact if it has one.
  await client.query(
    `DELETE FROM tenant.crm_contact_account_relationships dup_link USING tenant.crm_contact_account_relationships keep_link
      WHERE dup_link.organization_id = $1 AND dup_link.party_id = $2 AND keep_link.organization_id = $1 AND keep_link.party_id = $3 AND keep_link.contact_id = dup_link.contact_id`,
    move,
  );
  const keepHasPrimary = (await client.query(`SELECT 1 FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND party_id = $2 AND is_primary_contact`, [organizationId, keep.id])).rows[0];
  await client.query(`UPDATE tenant.crm_contact_account_relationships SET party_id = $3${keepHasPrimary ? ", is_primary_contact = false" : ""} WHERE organization_id = $1 AND party_id = $2`, move);
  await client.query(`UPDATE tenant.crm_activities SET related_party_id = $3 WHERE organization_id = $1 AND related_party_id = $2`, move);
  await client.query(`UPDATE tenant.crm_opportunities SET party_id = $3 WHERE organization_id = $1 AND party_id = $2`, move);
  await client.query(`UPDATE tenant.crm_leads SET converted_party_id = $3 WHERE organization_id = $1 AND converted_party_id = $2`, move);
  await client.query(`UPDATE tenant.business_parties SET parent_party_id = $3 WHERE organization_id = $1 AND parent_party_id = $2 AND id <> $3`, move);
  await client.query(`UPDATE tenant.addresses SET party_id = $3, is_default_billing = false, is_default_shipping = false, is_primary = false WHERE organization_id = $1 AND party_id = $2`, move);
  await client.query(`UPDATE tenant.crm_activities SET entity_id = $3 WHERE organization_id = $1 AND entity_type = 'party' AND entity_id = $2`, move);
  await client.query(`UPDATE tenant.crm_notes SET entity_id = $3 WHERE organization_id = $1 AND entity_type = 'party' AND entity_id = $2`, move);
  await client.query(`UPDATE public.attachments SET entity_id = $3::text WHERE organization_id = $1 AND entity_type = 'crm.party' AND entity_id = $2::text`, move);
  await client.query(`UPDATE tenant.crm_attachment_details SET entity_id = $3 WHERE organization_id = $1 AND entity_type = 'party' AND entity_id = $2`, move);
  for (const table of ["crm_communications", "crm_email_threads", "crm_calendar_events", "crm_conversations", "crm_field_visits", "crm_campaign_members"])
    await client.query(`UPDATE tenant.${table} SET party_id = $3 WHERE organization_id = $1 AND party_id = $2`, move);
  await client.query(
    `INSERT INTO tenant.crm_account_tags (organization_id, party_id, tag_id, created_by)
     SELECT organization_id, $3, tag_id, created_by FROM tenant.crm_account_tags WHERE organization_id = $1 AND party_id = $2 ON CONFLICT DO NOTHING`,
    move,
  );
  await client.query(`DELETE FROM tenant.crm_account_tags WHERE organization_id = $1 AND party_id = $2`, [organizationId, duplicate.id]);
  // Old links to the duplicate (and to anything already merged into it) now resolve to the kept account.
  await client.query(`UPDATE tenant.crm_entity_merge_aliases SET survivor_entity_id = $3 WHERE organization_id = $1 AND entity_type = 'account' AND survivor_entity_id = $2`, move);
  await client.query(
    `INSERT INTO tenant.crm_entity_merge_aliases (organization_id, entity_type, source_entity_id, survivor_entity_id, merged_by)
     VALUES ($1, 'account', $2, $3, $4)
     ON CONFLICT (organization_id, entity_type, source_entity_id) DO UPDATE SET survivor_entity_id = EXCLUDED.survivor_entity_id, merged_by = EXCLUDED.merged_by, merged_at = now()`,
    [organizationId, duplicate.id, keep.id, context.userId ?? null],
  );

  const columns = Object.keys(updates);
  await client.query(
    `UPDATE tenant.business_parties SET ${columns.map((column, index) => `${column} = $${index + 4}, `).join("")}
            last_activity_at = GREATEST(last_activity_at, $3::timestamptz), updated_by = $${columns.length + 4}, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, keep.id, duplicate.last_activity_at, ...columns.map((column) => updates[column]), context.userId ?? null],
  );

  const before = toAccount(keep);
  const changes = Object.fromEntries(Object.entries(MERGE_FIELDS).filter(([, column]) => column in updates).map(([field, column]) => [field, { from: before[field] ?? null, to: updates[column] }]));
  await recordAccountHistory(client, context, duplicate.id, "merged", `Merged into ${keep.display_name} (${keep.code})`, { mergedInto: keep.id });
  await recordAccountHistory(client, context, keep.id, "merged", `${duplicate.display_name} (${duplicate.code}) merged into this account`, { mergedFrom: duplicate.id, changes });
  await queueOutboxEvent(client, context, "crm.accounts.merged", "account", keep.id, { accountId: keep.id, mergedAccountId: duplicate.id });
  return { keptAccountId: keep.id, mergedAccountId: duplicate.id };
}
