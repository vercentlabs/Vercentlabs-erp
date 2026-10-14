// Projects — Customer Association rules: what makes a customer, a CRM account, a contact or a sales record acceptable for a project, checked by
// ID against the masters that own them (never by matching names), and the append-only association history. Shared by the project commands
// and the Customer Association commands.
import { PROJECT, has, projectError, text, uuid } from "./project-core.js";

const PARTY_COLUMNS = `party.id, party.display_name, party.legal_name, party.code, party.customer_number, party.party_type, party.status, party.archived_at, party.gstin,
  party.gst_state_code, party.place_of_supply, party.tax_treatment, party.sales_block, party.sales_block_reason, party.phone, party.email`;
export const isCustomerParty = (row) => Boolean(row?.customer_number) || ["customer", "both"].includes(row?.party_type);

export async function partyRow(client, c, partyId) {
  return (await client.query(`SELECT ${PARTY_COLUMNS} FROM tenant.business_parties party WHERE party.organization_id = $1 AND party.id = $2`,
    [c.organizationId, uuid(partyId, "Customer")])).rows[0] ?? null;
}
// Where a merged (archived) account now lives.
export async function mergedInto(client, c, partyId) {
  return (await client.query(`SELECT survivor.id, survivor.display_name FROM tenant.crm_entity_merge_aliases alias JOIN tenant.business_parties survivor ON survivor.id = alias.survivor_entity_id
      WHERE alias.organization_id = $1 AND alias.entity_type = 'account' AND alias.source_entity_id = $2`, [c.organizationId, partyId])).rows[0] ?? null;
}

// The customer a project may be associated with: a Customer Master record of this company (another company's record is simply not found). A new
// association refuses an inactive customer unless the company allows it; an existing one keeps an inactive customer visible (the history holds).
// purpose: "new" | "existing"
export async function customerRecord(client, c, customerId, { purpose = "new", settings = {} } = {}) {
  const row = await partyRow(client, c, customerId);
  if (!row) throw projectError(400, "PROJECT_CUSTOMER_NOT_FOUND", undefined, { field: "customerId" });
  if (row.status === "archived") {
    const survivor = await mergedInto(client, c, row.id);
    throw projectError(400, survivor ? "PROJECT_CUSTOMER_MERGE_REVIEW" : "PROJECT_CUSTOMER_NOT_FOUND",
      survivor ? `${row.display_name} was merged into ${survivor.display_name}: choose ${survivor.display_name}.` : `${row.display_name} is archived.`, { field: "customerId", survivorId: survivor?.id });
  }
  if (!isCustomerParty(row)) {
    if (row.party_type === "supplier") throw projectError(400, "PROJECT_CUSTOMER_NOT_FOUND", `${row.display_name} is a supplier, not a customer.`, { field: "customerId" });
    throw projectError(400, "PROJECT_CUSTOMER_MAPPING_UNRESOLVED", `${row.display_name} is a CRM account that is not yet a Customer: link it to a Customer record first.`, { field: "customerId", crmAccountId: row.id });
  }
  if (purpose === "new" && row.status === "inactive" && !settings.inactiveCustomerAllowed) throw projectError(400, "PROJECT_CUSTOMER_INACTIVE", undefined, { field: "customerId" });
  return row;
}
// A CRM account that is not yet a Customer, as a draft's provisional reference (only for someone who may see CRM accounts).
export async function crmAccountRecord(client, c, accountId) {
  if (!has(c, "crm.accounts.view")) throw projectError(403, "PROJECT_PERMISSION_DENIED", "You cannot see CRM accounts.");
  const row = await partyRow(client, c, accountId);
  if (!row || row.party_type === "supplier") throw projectError(400, "PROJECT_CUSTOMER_NOT_FOUND", "The selected CRM account could not be found.", { field: "crmAccountId" });
  if (row.status !== "active") throw projectError(400, "PROJECT_CUSTOMER_INACTIVE", `${row.display_name} is not an active CRM account.`, { field: "crmAccountId" });
  return row;
}

// A contact of the customer: their own company, or an active account relationship with it. A new link refuses an inactive or archived person.
export async function contactRecord(client, c, contactId, customerId, { purpose = "new" } = {}) {
  const row = (await client.query(
    `SELECT contact.id, contact.status, contact.party_id, COALESCE(NULLIF(contact.display_name, ''), btrim(concat_ws(' ', contact.first_name, contact.last_name))) AS name,
            (contact.party_id = $3 OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships relation WHERE relation.organization_id = $1 AND relation.contact_id = contact.id
               AND relation.party_id = $3 AND relation.status = 'active')) AS related
       FROM tenant.contacts contact WHERE contact.organization_id = $1 AND contact.id = $2`,
    [c.organizationId, uuid(contactId, "Contact"), customerId])).rows[0];
  if (!row || !row.related) throw projectError(400, "PROJECT_CUSTOMER_CONTACT_INVALID", undefined, { field: "contactId" });
  if (purpose === "new" && row.status !== "active") throw projectError(400, "PROJECT_CUSTOMER_CONTACT_INVALID", `${row.name} is ${row.status}: choose an active contact.`, { field: "contactId" });
  return row;
}

// The customer a sales or CRM record belongs to (null for records with none: procurement).
export const CUSTOMER_SCOPED = Object.freeze(new Set(["CRM_ACCOUNT", "CRM_CONTACT", "CRM_OPPORTUNITY", "SALES_QUOTATION", "SALES_ORDER", "SALES_INVOICE"]));
// Whether a record of a customer-scoped type belongs to the project's customer (or its provisional CRM account). A contact may belong through
// an account relationship.
export async function recordMatchesCustomer(client, c, type, record, partyId) {
  if (!partyId) return false;
  if (record.party_id === partyId) return true;
  // A person with no company of their own may still be the customer's contact through an account relationship.
  if (type !== "CRM_CONTACT") return false;
  return Boolean((await client.query(`SELECT 1 FROM tenant.crm_contact_account_relationships WHERE organization_id = $1 AND contact_id = $2 AND party_id = $3 AND status = 'active'`,
    [c.organizationId, record.id, partyId])).rows[0]);
}
// The project's party a link must match: its customer, or (a draft) its provisional CRM account.
export const projectParty = (project) => project.customer_id ?? project.crm_account_id ?? null;
// Linking a customer's sales and CRM records needs the sales-link permission besides managing links.
export const needsSalesLink = (type) => CUSTOMER_SCOPED.has(type);
export const mayLinkSales = (c) => has(c, PROJECT.customerSalesLink);

// ------------------------------------------------------------------ history
// One association change, written once per idempotency key (a repeated request finds it and writes nothing).
export async function customerEvent(client, c, projectId, type, summary, { fromCustomerId = null, toCustomerId = null, contactId = null, reason = null, details = {}, key = null } = {}) {
  const row = (await client.query(
    `INSERT INTO tenant.project_customer_events (organization_id, project_id, event_type, from_customer_id, to_customer_id, contact_id, summary, reason, details, actor_user_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
    [c.organizationId, projectId, type, fromCustomerId, toCustomerId, contactId, String(summary).slice(0, 1000), reason ? text(reason, 2000) : null, JSON.stringify(details), c.userId ?? null, key])).rows[0];
  return row?.id ?? null;
}
export async function customerEventReplay(client, c, key) {
  if (!key) return null;
  return (await client.query(`SELECT * FROM tenant.project_customer_events WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0] ?? null;
}

// ------------------------------------------------------------------ contacts kept in step
// projects.customer_contact_id mirrors the current primary project contact (the list, the sales-order create and older readers use it).
export async function syncPrimaryContact(client, c, projectId) {
  await client.query(
    `UPDATE tenant.projects project SET customer_contact_id = (SELECT contact_id FROM tenant.project_customer_contacts row WHERE row.project_id = project.id AND row.role = 'PRIMARY' AND row.status = 'ACTIVE')
      WHERE project.organization_id = $1 AND project.id = $2
        AND project.customer_contact_id IS DISTINCT FROM (SELECT contact_id FROM tenant.project_customer_contacts row WHERE row.project_id = project.id AND row.role = 'PRIMARY' AND row.status = 'ACTIVE')`,
    [c.organizationId, projectId]);
}
// The primary contact a project's own edit set (create, draft edit): one current PRIMARY row, the previous one removed.
export async function setPrimaryContactRow(client, c, project, contactId, note = "Primary contact changed") {
  const current = (await client.query(`SELECT * FROM tenant.project_customer_contacts WHERE project_id = $1 AND role = 'PRIMARY' AND status = 'ACTIVE' FOR UPDATE`, [project.id])).rows[0];
  if (current?.contact_id === contactId) return false;
  if (current) {
    await client.query(`UPDATE tenant.project_customer_contacts SET status = 'REMOVED', removed_at = clock_timestamp(), removed_by = $2, removal_note = $3, row_version = row_version + 1 WHERE id = $1`,
      [current.id, c.userId ?? null, note]);
  }
  if (contactId) {
    await client.query(`INSERT INTO tenant.project_customer_contacts (organization_id, project_id, contact_id, role, added_by) VALUES ($1,$2,$3,'PRIMARY',$4)`,
      [c.organizationId, project.id, contactId, c.userId ?? null]);
  }
  await syncPrimaryContact(client, c, project.id);
  return true;
}
// Contacts that are not the given customer's people are removed from the project (their history stays).
export async function removeContactsNotOf(client, c, project, customerId, note) {
  const rows = (await client.query(
    `SELECT row.id, row.contact_id FROM tenant.project_customer_contacts row JOIN tenant.contacts contact ON contact.id = row.contact_id
      WHERE row.project_id = $1 AND row.status = 'ACTIVE'
        AND NOT (contact.party_id IS NOT DISTINCT FROM $2::uuid OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships relation WHERE relation.contact_id = contact.id
              AND relation.party_id = $2::uuid AND relation.status = 'active'))
      FOR UPDATE OF row`, [project.id, customerId])).rows;
  for (const row of rows) {
    await client.query(`UPDATE tenant.project_customer_contacts SET status = 'REMOVED', removed_at = clock_timestamp(), removed_by = $2, removal_note = $3, row_version = row_version + 1 WHERE id = $1`,
      [row.id, c.userId ?? null, note]);
  }
  if (rows.length) await syncPrimaryContact(client, c, project.id);
  return rows;
}
