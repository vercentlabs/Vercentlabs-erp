// Projects — Customer Association: the customer a project serves, the customer's people on it with their project roles, the sites where it is
// delivered, the customer's sales and CRM records behind it, a reviewed customer change past the draft, and the project's reaction when the
// owning masters change underneath it (an account or contact merge, a linked sales order cancelled or amended). The customer, its contacts,
// addresses and documents stay with CRM and Sales: a project holds references (and, for a site, a snapshot), never an editable copy.
import { randomUUID } from "node:crypto";

import { GST_STATES, gstStateCode, gstStateName } from "../../core/tax/constants.js";
import {
  ACTIVE_STATUSES, PROJECT, STATUS_LABEL, activeMemberIds, canView, has, notifyProject, projectError, projectEvent, projectSettings, publishProjectEvent, seesAll, text, today,
  userNames, uuid, versionCheck, visibilitySql, visibleProject,
} from "./project-core.js";
import {
  CUSTOMER_SCOPED, contactRecord, crmAccountRecord, customerEvent, customerEventReplay, customerRecord, isCustomerParty, mergedInto, partyRow, projectParty, removeContactsNotOf,
  setPrimaryContactRow, syncPrimaryContact,
} from "./project-customer-rules.js";
import { LINK_SOURCES, insertLink, linkLabel, mismatchedLinks, updateProject } from "./project-service.js";

export const CONTACT_ROLES = Object.freeze({ PRIMARY: "Primary Contact", SPONSOR: "Project Sponsor", TECHNICAL: "Technical Contact", BILLING: "Billing Contact",
  APPROVAL: "Approval Contact", OTHER: "Other" });
const CLOSED = ["COMPLETED", "CANCELLED"];
const NAME_SQL = `COALESCE(NULLIF(contact.display_name, ''), btrim(concat_ws(' ', contact.first_name, contact.last_name)))`;

// ------------------------------------------------------------------ who may do what
// A project's customer is seen by someone who may see the project and the customer; it is changed by someone who steers the project (sees every
// project, or manages this one) and holds the matching permission. A project role never grants what the company role denies.
function customerCan(c, access, project) {
  const steer = (permission) => access.visible && has(c, permission) && (access.all || access.manager);
  const open = !CLOSED.includes(project.status) && !project.archived_at;
  return {
    view: access.visible && has(c, PROJECT.customerView),
    assign: steer(PROJECT.customerAssign) && project.status === "DRAFT",
    change: steer(PROJECT.customerChange) && project.classification === "CUSTOMER" && !project.archived_at,
    approve: access.visible && has(c, PROJECT.customerChange) && has(c, PROJECT.approve),
    contacts: steer(PROJECT.customerContacts) && open && project.classification === "CUSTOMER",
    sites: steer(PROJECT.customerSites) && open && project.classification === "CUSTOMER",
    salesLink: steer(PROJECT.customerSalesLink) && has(c, PROJECT.links) && project.classification === "CUSTOMER",
    history: access.visible && has(c, PROJECT.customerHistory),
    review: access.visible && (access.all || access.manager) && has(c, PROJECT.edit),
  };
}
async function projectFor(client, c, projectId, need, { lock = false } = {}) {
  const { project, access } = await visibleProject(client, c, projectId, { lock });
  const can = customerCan(c, access, project);
  if (need && !can[need]) {
    if (["contacts", "sites"].includes(need) && CLOSED.includes(project.status)) {
      throw projectError(409, "PROJECT_STATUS_INVALID", `${project.project_code} is ${STATUS_LABEL[project.status].toLowerCase()}: its customer details are kept as they were.`);
    }
    if (project.classification === "INTERNAL" && need !== "view" && need !== "history") throw projectError(400, "PROJECT_INPUT_INVALID", "An internal project has no customer.");
    throw projectError(403, "PROJECT_CUSTOMER_PERMISSION_DENIED");
  }
  return { project, access, can };
}
const conflict = (error) => (error?.code === "PROJECT_VERSION_CONFLICT" ? projectError(409, "PROJECT_CUSTOMER_VERSION_CONFLICT") : error);
const notifyTeam = async (client, c, project, title, message) =>
  notifyProject(client, c, project, [project.manager_user_id, ...await activeMemberIds(client, c, project.id)], { title, message });

// ------------------------------------------------------------------ finding a customer
const normalName = (value) => String(value ?? "").toLowerCase().replace(/\b(private|pvt|limited|ltd|llp|inc|co|company|the)\b/g, "").replace(/[^a-z0-9]/g, "");
// Customers (and, for someone who may see them, CRM accounts that are not yet Customers) of this company: by name, number, code, phone or GSTIN,
// with what tells them apart (city, number, status) and a warning where names look alike. Only for someone who may assign or change a project's
// customer, so the search never lists customers to anyone else. filters: { search, includeCrmAccounts }
export async function searchProjectEligibleCustomers(client, c, filters = {}) {
  if (!canView(c) || !(has(c, PROJECT.customerAssign) || has(c, PROJECT.customerChange))) throw projectError(403, "PROJECT_CUSTOMER_PERMISSION_DENIED");
  const search = text(filters.search, 100);
  const settings = await projectSettings(client, c);
  const accounts = Boolean(filters.includeCrmAccounts) && has(c, "crm.accounts.view");
  const rows = (await client.query(
    `SELECT party.id, party.display_name, party.legal_name, party.customer_number, party.code, party.party_type, party.status, party.gstin, party.sales_block,
            address.city, address.state
       FROM tenant.business_parties party
       LEFT JOIN LATERAL (SELECT city, state FROM tenant.addresses address WHERE address.organization_id = party.organization_id AND address.party_id = party.id AND address.status = 'active'
                           ORDER BY address.is_default_billing DESC, address.is_primary DESC, address.created_at LIMIT 1) address ON true
      WHERE party.organization_id = $1 AND party.status <> 'archived'
        AND (party.customer_number IS NOT NULL OR party.party_type IN ('customer', 'both') OR ($4 AND party.party_type = 'prospect'))
        AND ($2 = '' OR lower(party.display_name) LIKE $3 OR lower(COALESCE(party.legal_name, '')) LIKE $3 OR lower(COALESCE(party.customer_number, '')) LIKE $3
             OR lower(COALESCE(party.code, '')) LIKE $3 OR ($5 <> '' AND regexp_replace(COALESCE(party.phone, ''), '[^0-9]', '', 'g') LIKE $5) OR upper(COALESCE(party.gstin, '')) = upper($2))
      ORDER BY (party.status = 'active') DESC, party.display_name LIMIT 30`,
    [c.organizationId, search, `%${search.toLowerCase()}%`, accounts, search.replace(/[^0-9]/g, "").length >= 6 ? `%${search.replace(/[^0-9]/g, "")}%` : ""])).rows;
  const seen = new Map();
  for (const row of rows) seen.set(normalName(row.display_name), (seen.get(normalName(row.display_name)) ?? 0) + 1);
  return rows.map((row) => {
    const customer = isCustomerParty(row);
    return {
      id: row.id, name: row.display_name, legalName: row.legal_name, number: row.customer_number ?? row.code, kind: customer ? "CUSTOMER" : "CRM_ACCOUNT",
      city: row.city ?? null, state: row.state ?? null, status: row.status, inactive: row.status !== "active", salesBlocked: Boolean(row.sales_block),
      similarNames: (seen.get(normalName(row.display_name)) ?? 0) > 1,
      selectable: customer ? row.status === "active" || settings.inactiveCustomerAllowed : row.status === "active",
      note: !customer ? "CRM account — not yet a Customer" : row.status !== "active" ? "Inactive customer" : null,
    };
  });
}

// ------------------------------------------------------------------ the project's customer
const addressView = (row) => ({ id: row.id, type: row.address_type, label: row.label, line1: row.line1, line2: row.line2, city: row.city, district: row.district, state: row.state,
  stateCode: row.state_code, postalCode: row.postal_code, countryCode: row.country_code, gstin: row.gstin, defaultBilling: row.is_default_billing, defaultShipping: row.is_default_shipping,
  primary: row.is_primary });
// The customer as its masters hold it (read-only), the project's contacts and sites, the review flag, a pending customer change and what the
// person may do. Contact email and phone only for someone who may see project customers.
export async function getProjectCustomer(client, c, projectId) {
  const { project, can } = await projectFor(client, c, projectId, "view");
  const partyId = projectParty(project);
  const party = partyId ? await partyRow(client, c, partyId) : null;
  const survivor = party?.status === "archived" ? await mergedInto(client, c, party.id) : null;
  const addresses = party ? (await client.query(`SELECT * FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active'
      ORDER BY is_default_billing DESC, is_primary DESC, address_type, created_at`, [c.organizationId, party.id])).rows : [];
  const counts = party ? (await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('PLANNED', 'IN_PROGRESS', 'ON_HOLD'))::int AS active
      FROM tenant.projects WHERE organization_id = $1 AND deleted_at IS NULL AND (customer_id = $2 OR crm_account_id = $2)`, [c.organizationId, party.id])).rows[0] : null;
  const request = await pendingRequest(client, c, project.id);
  const settings = await projectSettings(client, c);
  const contacts = await contactRows(client, c, project, { includeRemoved: false });
  const sites = await siteRows(client, c, project, { includeRemoved: false });
  const links = (await client.query(`SELECT source_type, count(*)::int AS n FROM tenant.project_links WHERE organization_id = $1 AND project_id = $2 AND removed_at IS NULL AND source_type = ANY($3::text[]) GROUP BY 1`,
    [c.organizationId, project.id, [...CUSTOMER_SCOPED]])).rows;
  return {
    projectId: project.id, code: project.project_code, status: project.status, classification: project.classification, version: project.row_version,
    customer: project.customer_id && party ? {
      id: party.id, name: party.display_name, legalName: party.legal_name, number: party.customer_number, code: party.code, status: party.status, inactive: party.status !== "active",
      merged: survivor ? { id: survivor.id, name: survivor.display_name } : null, salesBlocked: Boolean(party.sales_block), salesBlockReason: party.sales_block_reason,
      // Tax identity, read-only from the customer master (Sales and Tax decide place of supply on each document; a project site never does).
      tax: { gstin: party.gstin, stateCode: party.gst_state_code, state: gstStateName(party.gst_state_code), placeOfSupply: party.place_of_supply, treatment: party.tax_treatment },
      phone: can.view ? party.phone : null, email: can.view ? party.email : null,
      addresses: addresses.map(addressView), projects: counts,
    } : null,
    provisional: !project.customer_id && project.crm_account_id && party ? { id: party.id, name: party.display_name, status: party.status,
      nowCustomer: isCustomerParty(party), mergedInto: survivor ? { id: survivor.id, name: survivor.display_name } : null } : null,
    contacts, sites, primaryContactRequired: settings.primaryContactRequired, gstStates: GST_STATES,
    salesLinks: links.map((row) => ({ type: row.source_type, count: row.n })),
    review: project.customer_review_required ? { reason: project.customer_review_reason, at: project.customer_review_at } : null,
    changeRequest: request, changeApprovalRequired: settings.customerChangeApprovalRequired,
    can: { ...can, resolveMapping: can.assign && Boolean(project.crm_account_id), approveRequest: Boolean(request) && can.approve && (settings.selfApprovalAllowed || request.requestedById !== c.userId),
      withdrawRequest: Boolean(request) && (request.requestedById === c.userId || can.change) },
  };
}

// Choose (or replace, or clear) the customer of a draft, with its primary contact and the sales order behind it. A project past the draft
// changes its customer through a change request. input: { customerId? | crmAccountId?, primaryContactId?, linkedSalesOrderId?, linkedSalesOrderLineIds?,
// expectedVersion?, idempotencyKey? }
export async function assignProjectCustomer(client, c, projectId, input = {}) {
  const key = text(input.idempotencyKey, 200) || null;
  const done = await customerEventReplay(client, c, key);
  if (done) return { projectId: done.project_id, replayed: true };
  const { project } = await visibleProject(client, c, projectId, { lock: true });
  if (project.status !== "DRAFT") throw projectError(409, "PROJECT_CUSTOMER_CHANGE_BLOCKED", `${project.project_code} is ${STATUS_LABEL[project.status].toLowerCase()}: request a customer change instead.`);
  await projectFor(client, c, projectId, "assign");
  const fields = { classification: "CUSTOMER", expectedVersion: input.expectedVersion, associationKey: key };
  if (input.crmAccountId && !input.customerId) fields.crmAccountId = input.crmAccountId;
  else fields.customerId = input.customerId || null;
  if (input.primaryContactId !== undefined) fields.customerContactId = input.primaryContactId || null;
  let result;
  try { result = await updateProject(client, c, project.id, fields); } catch (error) { throw conflict(error); }
  const salesOrderId = input.linkedSalesOrderId ? uuid(input.linkedSalesOrderId, "Sales order") : null;
  if (salesOrderId) {
    const current = await visibleProject(client, c, project.id, { lock: true });
    const lines = Array.isArray(input.linkedSalesOrderLineIds) && input.linkedSalesOrderLineIds.length ? input.linkedSalesOrderLineIds : [null];
    for (const lineId of lines) await insertLink(client, c, current.project, { sourceType: "SALES_ORDER", sourceId: salesOrderId, sourceLineId: lineId ?? undefined, linkType: "ORIGIN" });
  }
  return { projectId: project.id, version: result.version, changed: result.changed };
}
// A draft whose CRM account has since become a Customer (or was linked into one): the project takes that Customer.
export async function resolveProjectCustomerMapping(client, c, projectId, input = {}) {
  const { project } = await projectFor(client, c, projectId, "assign", { lock: true });
  if (!project.crm_account_id) return { projectId: project.id, customerId: project.customer_id, replayed: true };
  let party = await partyRow(client, c, project.crm_account_id);
  if (party?.status === "archived") {
    const survivor = await mergedInto(client, c, party.id);
    party = survivor ? await partyRow(client, c, survivor.id) : party;
  }
  if (!party || !isCustomerParty(party)) throw projectError(409, "PROJECT_CUSTOMER_MAPPING_UNRESOLVED");
  try {
    await updateProject(client, c, project.id, { customerId: party.id, expectedVersion: input.expectedVersion });
  } catch (error) { throw conflict(error); }
  return { projectId: project.id, customerId: party.id };
}

// ------------------------------------------------------------------ the customer's contacts on the project
async function contactRows(client, c, project, { includeRemoved = false } = {}) {
  const rows = (await client.query(
    `SELECT row.*, ${NAME_SQL} AS name, contact.email, contact.phone, contact.mobile, contact.designation, contact.status AS contact_status, contact.party_id,
            (contact.party_id IS NOT DISTINCT FROM $3::uuid OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships relation WHERE relation.contact_id = contact.id
               AND relation.party_id = $3::uuid AND relation.status = 'active')) AS related
       FROM tenant.project_customer_contacts row JOIN tenant.contacts contact ON contact.id = row.contact_id
      WHERE row.organization_id = $1 AND row.project_id = $2 ${includeRemoved ? "" : "AND row.status = 'ACTIVE'"}
      ORDER BY row.status, CASE row.role WHEN 'PRIMARY' THEN 0 ELSE 1 END, row.added_at`, [c.organizationId, project.id, projectParty(project)])).rows;
  const names = await userNames(client, rows.flatMap((row) => [row.added_by, row.removed_by]));
  const details = has(c, PROJECT.customerView);
  return rows.map((row) => ({
    id: row.id, contactId: row.contact_id, name: row.name, designation: row.designation, role: row.role, roleLabel: CONTACT_ROLES[row.role], title: row.title, primary: row.role === "PRIMARY",
    email: details ? row.email : null, phone: details ? row.phone || row.mobile : null, active: row.status === "ACTIVE",
    // The person's own state in CRM: an inactive or archived contact, or one no longer with the customer, stays on the project, marked.
    contactStatus: row.contact_status, relatedToCustomer: row.related, addedBy: names.get(row.added_by) ?? null, addedAt: row.added_at,
    removedBy: names.get(row.removed_by) ?? null, removedAt: row.removed_at, removalNote: row.removal_note, version: row.row_version,
  }));
}
export async function listProjectCustomerContactsOnProject(client, c, projectId, { includeRemoved = false } = {}) {
  const { project, can } = await projectFor(client, c, projectId, "view");
  return { contacts: await contactRows(client, c, project, { includeRemoved }), roles: Object.entries(CONTACT_ROLES).map(([code, name]) => ({ code, name })), can: { manage: can.contacts } };
}
// The customer's people a project may add (active, of the customer).
export async function listEligibleProjectContacts(client, c, projectId, search = "") {
  const { project } = await projectFor(client, c, projectId, "contacts");
  const party = projectParty(project);
  if (!party) throw projectError(400, "PROJECT_CUSTOMER_REQUIRED", "Choose the customer before its contacts.");
  const term = text(search, 100).toLowerCase();
  return (await client.query(
    `SELECT DISTINCT contact.id, ${NAME_SQL} AS name, contact.email, contact.designation FROM tenant.contacts contact
      WHERE contact.organization_id = $1 AND contact.status = 'active'
        AND (contact.party_id = $2 OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships relation WHERE relation.contact_id = contact.id AND relation.party_id = $2 AND relation.status = 'active'))
        AND ($3 = '' OR lower(${NAME_SQL}) LIKE $4 OR lower(COALESCE(contact.email, '')) LIKE $4)
      ORDER BY 2 LIMIT 100`, [c.organizationId, party, term, `%${term}%`])).rows;
}
const roleOf = (value) => {
  const role = String(value ?? "").toUpperCase();
  if (!CONTACT_ROLES[role]) throw projectError(400, "PROJECT_INPUT_INVALID", "Choose the contact's role on the project.", { field: "role" });
  return role;
};
const titleOf = (role, value) => {
  const title = text(value, 120) || null;
  if (title && title.length < 2) throw projectError(400, "PROJECT_INPUT_INVALID", "Describe the role in 2 to 120 characters.", { field: "title" });
  if (role === "OTHER" && !title) throw projectError(400, "PROJECT_INPUT_INVALID", "Describe what this contact does on the project.", { field: "title" });
  return title;
};
async function currentPrimary(client, project) {
  return (await client.query(`SELECT * FROM tenant.project_customer_contacts WHERE project_id = $1 AND role = 'PRIMARY' AND status = 'ACTIVE' FOR UPDATE`, [project.id])).rows[0] ?? null;
}
// input: { contactId, role, title?, replacePrimary? } — one of the customer's active people; a second primary contact only by replacing the first.
export async function addProjectCustomerContact(client, c, projectId, input = {}) {
  const { project } = await projectFor(client, c, projectId, "contacts", { lock: true });
  const party = projectParty(project);
  if (!party) throw projectError(400, "PROJECT_CUSTOMER_REQUIRED", "Choose the customer before its contacts.");
  const role = roleOf(input.role);
  const title = titleOf(role, input.title);
  const contact = await contactRecord(client, c, input.contactId, party);
  const existing = (await client.query(`SELECT id FROM tenant.project_customer_contacts WHERE project_id = $1 AND contact_id = $2 AND role = $3 AND status = 'ACTIVE'`, [project.id, contact.id, role])).rows[0];
  if (existing) return { contactRowId: existing.id, replayed: true };
  if (role === "PRIMARY") {
    const primary = await currentPrimary(client, project);
    if (primary && !input.replacePrimary) throw projectError(409, "PROJECT_CUSTOMER_PRIMARY_DUPLICATE", "This project already has a primary contact: replace them, or choose another role.");
    if (primary) {
      await client.query(`UPDATE tenant.project_customer_contacts SET status = 'REMOVED', removed_at = clock_timestamp(), removed_by = $2, removal_note = 'Replaced as primary contact', row_version = row_version + 1 WHERE id = $1`,
        [primary.id, c.userId ?? null]);
    }
  }
  const id = randomUUID();
  await client.query(`INSERT INTO tenant.project_customer_contacts (id, organization_id, project_id, contact_id, role, title, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, c.organizationId, project.id, contact.id, role, title, c.userId ?? null]);
  if (role === "PRIMARY") await syncPrimaryContact(client, c, project.id);
  await customerEvent(client, c, project.id, role === "PRIMARY" ? "PRIMARY_CONTACT_CHANGED" : "CONTACT_ADDED", `${contact.name} added as ${CONTACT_ROLES[role]}${title ? ` (${title})` : ""}`, { contactId: contact.id });
  await projectEvent(client, c, project.id, "CUSTOMER_CONTACT_ADDED", `${contact.name} · ${CONTACT_ROLES[role]}`);
  if (role === "PRIMARY") await notifyTeam(client, c, project, `${project.project_code}: new primary contact`, `${contact.name} is the customer's primary contact.`);
  return { contactRowId: id };
}
// input: { role?, title?, replacePrimary?, expectedVersion? } — the person's project role changes; their CRM record does not.
export async function updateProjectCustomerContact(client, c, projectId, rowId, input = {}) {
  const { project } = await projectFor(client, c, projectId, "contacts", { lock: true });
  const row = (await client.query(`SELECT row.*, ${NAME_SQL} AS name FROM tenant.project_customer_contacts row JOIN tenant.contacts contact ON contact.id = row.contact_id
      WHERE row.organization_id = $1 AND row.project_id = $2 AND row.id = $3 FOR UPDATE OF row`, [c.organizationId, project.id, uuid(rowId, "Project contact")])).rows[0];
  if (!row || row.status !== "ACTIVE") throw projectError(404, "PROJECT_NOT_FOUND", "That contact is not on the project.");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== row.row_version) throw projectError(409, "PROJECT_CUSTOMER_VERSION_CONFLICT");
  const role = input.role === undefined ? row.role : roleOf(input.role);
  const title = titleOf(role, input.title === undefined ? row.title : input.title);
  if (role === row.role && title === row.title) return { contactRowId: row.id, version: row.row_version };
  if (role === "PRIMARY" && row.role !== "PRIMARY") {
    const primary = await currentPrimary(client, project);
    if (primary && !input.replacePrimary) throw projectError(409, "PROJECT_CUSTOMER_PRIMARY_DUPLICATE");
    if (primary) await client.query(`UPDATE tenant.project_customer_contacts SET status = 'REMOVED', removed_at = clock_timestamp(), removed_by = $2, removal_note = 'Replaced as primary contact', row_version = row_version + 1 WHERE id = $1`,
      [primary.id, c.userId ?? null]);
  }
  if (role !== row.role && (await client.query(`SELECT 1 FROM tenant.project_customer_contacts WHERE project_id = $1 AND contact_id = $2 AND role = $3 AND status = 'ACTIVE' AND id <> $4`,
    [project.id, row.contact_id, role, row.id])).rows[0]) throw projectError(409, "PROJECT_INPUT_INVALID", `${row.name} already has that role on the project.`);
  await client.query(`UPDATE tenant.project_customer_contacts SET role = $2, title = $3, row_version = row_version + 1 WHERE id = $1`, [row.id, role, title]);
  if (role === "PRIMARY" || row.role === "PRIMARY") await syncPrimaryContact(client, c, project.id);
  await customerEvent(client, c, project.id, role === "PRIMARY" && row.role !== "PRIMARY" ? "PRIMARY_CONTACT_CHANGED" : "CONTACT_UPDATED",
    `${row.name}: ${CONTACT_ROLES[row.role]} → ${CONTACT_ROLES[role]}${title ? ` (${title})` : ""}`, { contactId: row.contact_id });
  return { contactRowId: row.id, version: row.row_version + 1 };
}
// input: { contactId } — the primary contact chosen from the customer's people (the person keeps any other project role).
export async function setProjectPrimaryContact(client, c, projectId, input = {}) {
  const { project } = await projectFor(client, c, projectId, "contacts", { lock: true });
  const party = projectParty(project);
  if (!party) throw projectError(400, "PROJECT_CUSTOMER_REQUIRED", "Choose the customer before its contacts.");
  const contact = input.contactId ? await contactRecord(client, c, input.contactId, party) : null;
  const changed = await setPrimaryContactRow(client, c, project, contact?.id ?? null, "Replaced as primary contact");
  if (!changed) return { projectId: project.id, contactId: contact?.id ?? null, replayed: true };
  await customerEvent(client, c, project.id, "PRIMARY_CONTACT_CHANGED", contact ? `${contact.name} is the primary contact` : "No primary contact now", { contactId: contact?.id ?? null });
  await notifyTeam(client, c, project, `${project.project_code}: primary contact changed`, contact ? `${contact.name} is the customer's primary contact.` : "The project has no primary contact now.");
  return { projectId: project.id, contactId: contact?.id ?? null };
}
// The person leaves the project; what they approved or said stays attributed to them. input: { note? }
export async function removeProjectCustomerContact(client, c, projectId, rowId, input = {}) {
  const { project } = await projectFor(client, c, projectId, "contacts", { lock: true });
  const row = (await client.query(`SELECT row.*, ${NAME_SQL} AS name FROM tenant.project_customer_contacts row JOIN tenant.contacts contact ON contact.id = row.contact_id
      WHERE row.organization_id = $1 AND row.project_id = $2 AND row.id = $3 FOR UPDATE OF row`, [c.organizationId, project.id, uuid(rowId, "Project contact")])).rows[0];
  if (!row) throw projectError(404, "PROJECT_NOT_FOUND", "That contact is not on the project.");
  if (row.status !== "ACTIVE") return { removed: true, replayed: true };
  await client.query(`UPDATE tenant.project_customer_contacts SET status = 'REMOVED', removed_at = clock_timestamp(), removed_by = $2, removal_note = $3, row_version = row_version + 1 WHERE id = $1`,
    [row.id, c.userId ?? null, text(input.note, 500) || null]);
  if (row.role === "PRIMARY") await syncPrimaryContact(client, c, project.id);
  await customerEvent(client, c, project.id, "CONTACT_REMOVED", `${row.name} (${CONTACT_ROLES[row.role]}) left the project`, { contactId: row.contact_id, reason: text(input.note, 500) || null });
  if (row.role === "PRIMARY") await notifyTeam(client, c, project, `${project.project_code}: no primary contact`, `${row.name} is no longer the customer's primary contact.`);
  return { removed: true };
}
// Another of the customer's people takes over the role (the first person's history stays). input: { contactId, note? }
export async function replaceProjectCustomerContact(client, c, projectId, rowId, input = {}) {
  const { project } = await projectFor(client, c, projectId, "contacts", { lock: true });
  const row = (await client.query(`SELECT row.*, ${NAME_SQL} AS name FROM tenant.project_customer_contacts row JOIN tenant.contacts contact ON contact.id = row.contact_id
      WHERE row.organization_id = $1 AND row.project_id = $2 AND row.id = $3 AND row.status = 'ACTIVE' FOR UPDATE OF row`, [c.organizationId, project.id, uuid(rowId, "Project contact")])).rows[0];
  if (!row) throw projectError(404, "PROJECT_NOT_FOUND", "That contact is not on the project.");
  const next = await contactRecord(client, c, input.contactId, projectParty(project));
  if (next.id === row.contact_id) return { contactRowId: row.id, replayed: true };
  await client.query(`UPDATE tenant.project_customer_contacts SET status = 'REMOVED', removed_at = clock_timestamp(), removed_by = $2, removal_note = $3, row_version = row_version + 1 WHERE id = $1`,
    [row.id, c.userId ?? null, text(input.note, 500) || `Replaced by ${next.name}`]);
  const id = randomUUID();
  await client.query(`INSERT INTO tenant.project_customer_contacts (id, organization_id, project_id, contact_id, role, title, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT DO NOTHING`, [id, c.organizationId, project.id, next.id, row.role, row.title, c.userId ?? null]);
  if (row.role === "PRIMARY") await syncPrimaryContact(client, c, project.id);
  await customerEvent(client, c, project.id, "CONTACT_REPLACED", `${next.name} replaces ${row.name} as ${CONTACT_ROLES[row.role]}`, { contactId: next.id, details: { previousContactId: row.contact_id } });
  if (row.role === "PRIMARY") await notifyTeam(client, c, project, `${project.project_code}: new primary contact`, `${next.name} replaces ${row.name}.`);
  return { contactRowId: id };
}

// ------------------------------------------------------------------ sites
const siteView = (row) => ({ id: row.id, name: row.site_name, sourceAddressId: row.source_address_id, line1: row.line1, line2: row.line2, city: row.city, district: row.district,
  state: row.state, stateCode: row.state_code, postalCode: row.postal_code, countryCode: row.country_code, primary: row.is_primary, active: row.status === "ACTIVE",
  createdAt: row.created_at, updatedAt: row.updated_at, removedAt: row.removed_at, version: row.row_version });
async function siteRows(client, c, project, { includeRemoved = false } = {}) {
  return (await client.query(`SELECT * FROM tenant.project_customer_sites WHERE organization_id = $1 AND project_id = $2 ${includeRemoved ? "" : "AND status = 'ACTIVE'"}
      ORDER BY status, is_primary DESC, created_at`, [c.organizationId, project.id])).rows.map(siteView);
}
export async function listProjectSites(client, c, projectId, { includeRemoved = false } = {}) {
  const { project, can } = await projectFor(client, c, projectId, "view");
  return { sites: await siteRows(client, c, project, { includeRemoved }), can: { manage: can.sites } };
}
// The address a site keeps: copied from one of the customer's addresses, or typed for the project; checked as shared addresses are (an Indian
// address names a real state and a six-digit PIN code).
async function siteAddress(client, c, project, input, current = null) {
  if (input.sourceAddressId) {
    const party = projectParty(project);
    const address = (await client.query(`SELECT * FROM tenant.addresses WHERE organization_id = $1 AND id = $2 AND party_id = $3 AND status = 'active'`,
      [c.organizationId, uuid(input.sourceAddressId, "Address"), party])).rows[0];
    if (!address) throw projectError(400, "PROJECT_INPUT_INVALID", "Choose one of the customer's active addresses.", { field: "sourceAddressId" });
    return { source_address_id: address.id, line1: address.line1, line2: address.line2, city: address.city, district: address.district, state: address.state,
      state_code: address.state_code, postal_code: address.postal_code, country_code: String(address.country_code ?? "IN").trim().toUpperCase() };
  }
  const pick = (key, column, max) => (input[key] !== undefined ? text(input[key], max) || null : current?.[column] ?? null);
  const out = { source_address_id: input.sourceAddressId === null ? null : current?.source_address_id ?? null, line1: pick("line1", "line1", 200), line2: pick("line2", "line2", 200),
    city: pick("city", "city", 80), district: pick("district", "district", 80), state: pick("state", "state", 80), state_code: pick("stateCode", "state_code", 4),
    postal_code: pick("postalCode", "postal_code", 12), country_code: (pick("countryCode", "country_code", 2) ?? "IN").toUpperCase() };
  if (!out.line1 || out.line1.length < 2) throw projectError(400, "PROJECT_INPUT_INVALID", "Enter the site's address.", { field: "line1" });
  if (!out.city || out.city.length < 2) throw projectError(400, "PROJECT_INPUT_INVALID", "Enter the city.", { field: "city" });
  if (!/^[A-Z]{2}$/.test(out.country_code)) throw projectError(400, "PROJECT_INPUT_INVALID", "Choose the country.", { field: "countryCode" });
  if (out.country_code === "IN") {
    const code = out.state_code ? String(out.state_code).padStart(2, "0") : gstStateCode(out.state);
    if (!code || !gstStateName(code)) throw projectError(400, "PROJECT_INPUT_INVALID", "Choose the state.", { field: "stateCode" });
    out.state_code = code;
    out.state = gstStateName(code);
    if (out.postal_code && !/^[1-9][0-9]{5}$/.test(out.postal_code)) throw projectError(400, "PROJECT_INPUT_INVALID", "Enter a six-digit PIN code.", { field: "postalCode" });
  }
  return out;
}
// input: { siteName, sourceAddressId? | line1, line2?, city, district?, state?, stateCode?, postalCode?, countryCode?, isPrimary? }
export async function addProjectSite(client, c, projectId, input = {}) {
  const { project } = await projectFor(client, c, projectId, "sites", { lock: true });
  const name = text(input.siteName, 120);
  if (name.length < 2) throw projectError(400, "PROJECT_INPUT_INVALID", "Name the site (factory, branch, office...).", { field: "siteName" });
  const address = await siteAddress(client, c, project, input);
  const first = !(await client.query(`SELECT 1 FROM tenant.project_customer_sites WHERE project_id = $1 AND status = 'ACTIVE' LIMIT 1`, [project.id])).rows[0];
  const primary = Boolean(input.isPrimary) || first;
  if (primary) await client.query(`UPDATE tenant.project_customer_sites SET is_primary = false, row_version = row_version + 1, updated_at = clock_timestamp() WHERE project_id = $1 AND is_primary AND status = 'ACTIVE'`, [project.id]);
  const id = randomUUID();
  await client.query(`INSERT INTO tenant.project_customer_sites (id, organization_id, project_id, site_name, source_address_id, line1, line2, city, district, state, state_code, postal_code,
      country_code, is_primary, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
    [id, c.organizationId, project.id, name, address.source_address_id, address.line1, address.line2, address.city, address.district, address.state, address.state_code,
      address.postal_code, address.country_code, primary, c.userId ?? null]);
  await customerEvent(client, c, project.id, "SITE_ADDED", `${name}, ${address.city}${primary ? " (primary site)" : ""}`, { details: { siteId: id } });
  return { siteId: id, primary };
}
// input: the fields to change, isPrimary?, expectedVersion? — the project's snapshot changes; the customer's address does not.
export async function updateProjectSite(client, c, projectId, siteId, input = {}) {
  const { project } = await projectFor(client, c, projectId, "sites", { lock: true });
  const row = (await client.query(`SELECT * FROM tenant.project_customer_sites WHERE organization_id = $1 AND project_id = $2 AND id = $3 AND status = 'ACTIVE' FOR UPDATE`,
    [c.organizationId, project.id, uuid(siteId, "Site")])).rows[0];
  if (!row) throw projectError(404, "PROJECT_NOT_FOUND", "That site is not on the project.");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== row.row_version) throw projectError(409, "PROJECT_CUSTOMER_VERSION_CONFLICT");
  const name = input.siteName === undefined ? row.site_name : text(input.siteName, 120);
  if (name.length < 2) throw projectError(400, "PROJECT_INPUT_INVALID", "Name the site.", { field: "siteName" });
  const address = await siteAddress(client, c, project, input, row);
  const primary = input.isPrimary === undefined ? row.is_primary : Boolean(input.isPrimary);
  if (primary && !row.is_primary) await client.query(`UPDATE tenant.project_customer_sites SET is_primary = false, row_version = row_version + 1, updated_at = clock_timestamp() WHERE project_id = $1 AND is_primary AND status = 'ACTIVE'`, [project.id]);
  await client.query(`UPDATE tenant.project_customer_sites SET site_name = $2, source_address_id = $3, line1 = $4, line2 = $5, city = $6, district = $7, state = $8, state_code = $9,
      postal_code = $10, country_code = $11, is_primary = $12, updated_by = $13, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`,
    [row.id, name, address.source_address_id, address.line1, address.line2, address.city, address.district, address.state, address.state_code, address.postal_code, address.country_code,
      primary, c.userId ?? null]);
  await customerEvent(client, c, project.id, "SITE_UPDATED", `${name}, ${address.city}${primary && !row.is_primary ? " is now the primary site" : ""}`, { details: { siteId: row.id } });
  return { siteId: row.id, version: row.row_version + 1 };
}
export async function removeProjectSite(client, c, projectId, siteId) {
  const { project } = await projectFor(client, c, projectId, "sites", { lock: true });
  const row = (await client.query(`SELECT * FROM tenant.project_customer_sites WHERE organization_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`, [c.organizationId, project.id, uuid(siteId, "Site")])).rows[0];
  if (!row) throw projectError(404, "PROJECT_NOT_FOUND", "That site is not on the project.");
  if (row.status !== "ACTIVE") return { removed: true, replayed: true };
  await client.query(`UPDATE tenant.project_customer_sites SET status = 'REMOVED', is_primary = false, removed_at = clock_timestamp(), removed_by = $2, row_version = row_version + 1 WHERE id = $1`,
    [row.id, c.userId ?? null]);
  await customerEvent(client, c, project.id, "SITE_REMOVED", `${row.site_name}, ${row.city} removed`, { details: { siteId: row.id } });
  return { removed: true };
}

// ------------------------------------------------------------------ changing the customer past the draft
async function pendingRequest(client, c, projectId) {
  const row = (await client.query(`SELECT request.*, target.display_name AS to_name FROM tenant.project_customer_change_requests request
      JOIN tenant.business_parties target ON target.id = request.to_customer_id WHERE request.project_id = $1 AND request.status = 'PENDING'`, [projectId])).rows[0];
  if (!row) return null;
  const names = await userNames(client, [row.requested_by]);
  return { id: row.id, toCustomerId: row.to_customer_id, toCustomer: row.to_name, reason: row.reason, review: row.review, requestedBy: names.get(row.requested_by) ?? null,
    requestedById: row.requested_by, requestedAt: row.requested_at };
}
// What changing the customer would touch: what blocks it (invoices issued, the old customer's sales records still linked, a completed project) and
// what to acknowledge (contacts that leave, sites taken from the old customer's addresses, procurement links, files and notes).
async function changeReview(client, c, project, target) {
  const blocking = [];
  const warnings = [];
  if (project.status === "COMPLETED") blocking.push({ code: "PROJECT_COMPLETED", message: "A completed project keeps its customer: reopen it, or record the correction on a new project." });
  const invoices = (await client.query(
    `SELECT DISTINCT invoice.invoice_number FROM tenant.accounting_customer_invoices invoice
      WHERE invoice.organization_id = $1 AND invoice.status NOT IN ('draft', 'pending_approval', 'cancelled', 'reversed')
        AND (EXISTS (SELECT 1 FROM tenant.project_links link WHERE link.project_id = $2 AND link.removed_at IS NULL AND link.source_type = 'SALES_INVOICE' AND link.source_id = invoice.id)
          OR EXISTS (SELECT 1 FROM tenant.project_links link WHERE link.project_id = $2 AND link.removed_at IS NULL AND link.source_type = 'SALES_ORDER' AND link.source_id = invoice.source_sales_order_id))`,
    [c.organizationId, project.id])).rows;
  if (invoices.length) {
    blocking.push({ code: "INVOICES_ISSUED", message: `Invoices ${invoices.map((row) => row.invoice_number ?? "—").join(", ")} were issued for this project's work: Finance and Sales resolve them before the customer can change (an invoice's payer never changes through a project).` });
  }
  for (const mismatch of await mismatchedLinks(client, c, project, target.id)) {
    blocking.push({ code: "SALES_RECORD_LINKED", message: `${mismatch.label} belongs to the current customer: unlink it first (the record itself is not changed).`, linkId: mismatch.linkId });
  }
  const leaving = (await client.query(
    `SELECT DISTINCT ${NAME_SQL} AS name FROM tenant.project_customer_contacts row JOIN tenant.contacts contact ON contact.id = row.contact_id
      WHERE row.project_id = $1 AND row.status = 'ACTIVE' AND NOT (contact.party_id IS NOT DISTINCT FROM $2::uuid OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships relation
        WHERE relation.contact_id = contact.id AND relation.party_id = $2::uuid AND relation.status = 'active'))`, [project.id, target.id])).rows;
  if (leaving.length) warnings.push({ code: "CONTACTS_LEAVE", message: `${leaving.map((row) => row.name).join(", ")} ${leaving.length === 1 ? "is" : "are"} not ${target.display_name}'s and will leave the project.` });
  const sites = (await client.query(`SELECT site.site_name FROM tenant.project_customer_sites site JOIN tenant.addresses address ON address.id = site.source_address_id
      WHERE site.project_id = $1 AND site.status = 'ACTIVE' AND address.party_id IS DISTINCT FROM $2::uuid`, [project.id, target.id])).rows;
  if (sites.length) warnings.push({ code: "SITES_OF_OLD_CUSTOMER", message: `Sites ${sites.map((row) => row.site_name).join(", ")} came from the current customer's addresses: review them after the change.` });
  const procurement = Number((await client.query(`SELECT count(*) AS n FROM tenant.project_links WHERE project_id = $1 AND removed_at IS NULL AND source_type IN ('PURCHASE_ORDER', 'SUPPLIER_BILL')`, [project.id])).rows[0].n);
  if (procurement) warnings.push({ code: "PROCUREMENT_LINKED", message: `${procurement} purchase record(s) are linked: check they still belong to this work.` });
  const material = (await client.query(`SELECT (SELECT count(*) FROM tenant.project_notes WHERE project_id = $1 AND deleted_at IS NULL) AS notes,
      (SELECT count(*) FROM public.attachments WHERE organization_id = $2 AND entity_type = 'projects.project' AND entity_id = $1::text AND archived_at IS NULL) AS files`, [project.id, c.organizationId])).rows[0];
  if (Number(material.notes) || Number(material.files)) warnings.push({ code: "CUSTOMER_MATERIAL", message: `${material.notes} note(s) and ${material.files} file(s) may hold the current customer's information: review who may see them.` });
  return { blocking, warnings };
}
// The review a person sees before asking: input { toCustomerId }
export async function previewProjectCustomerChange(client, c, projectId, toCustomerId) {
  const { project } = await projectFor(client, c, projectId, "change");
  const settings = await projectSettings(client, c);
  const target = await customerRecord(client, c, toCustomerId, { purpose: "new", settings });
  if (target.id === project.customer_id) throw projectError(400, "PROJECT_INPUT_INVALID", `${target.display_name} is already the customer.`);
  const review = await changeReview(client, c, project, target);
  return { ...review, approvalRequired: approvalNeeded(project, settings), toCustomer: { id: target.id, name: target.display_name, inactive: target.status !== "active" } };
}
// Planned: the company's policy decides; in progress, on hold or a correction of a cancelled project: always someone else's approval.
const approvalNeeded = (project, settings) => project.status !== "DRAFT" && (["IN_PROGRESS", "ON_HOLD", "CANCELLED"].includes(project.status) || settings.customerChangeApprovalRequired);
// input: { toCustomerId, toContactId?, reason, acknowledgeWarnings?, correction?, expectedVersion?, idempotencyKey? }
export async function requestProjectCustomerChange(client, c, projectId, input = {}) {
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT id, status, project_id FROM tenant.project_customer_change_requests WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { requestId: done.id, projectId: done.project_id, status: done.status, replayed: true };
  }
  const { project } = await projectFor(client, c, projectId, "change", { lock: true });
  try { versionCheck(project, input.expectedVersion); } catch (error) { throw conflict(error); }
  if (project.status === "COMPLETED") throw projectError(409, "PROJECT_CUSTOMER_CHANGE_BLOCKED", "A completed project keeps its customer: reopen it, or record the correction on a new project.");
  if (project.status === "CANCELLED" && !input.correction) throw projectError(409, "PROJECT_CUSTOMER_CHANGE_BLOCKED", "A cancelled project's customer changes only as a recorded correction.");
  const reason = text(input.reason, 2000);
  if (project.status !== "DRAFT" && reason.length < 3) throw projectError(400, "PROJECT_REASON_REQUIRED", "Say why the customer changes.");
  if (await pendingRequest(client, c, project.id)) throw projectError(409, "PROJECT_CUSTOMER_APPROVAL_REQUIRED", "A customer change is already waiting for approval.");
  const settings = await projectSettings(client, c);
  const target = await customerRecord(client, c, input.toCustomerId, { purpose: "new", settings });
  if (target.id === project.customer_id) throw projectError(400, "PROJECT_INPUT_INVALID", `${target.display_name} is already the customer.`);
  const contact = input.toContactId ? await contactRecord(client, c, input.toContactId, target.id) : null;
  const review = await changeReview(client, c, project, target);
  if (review.blocking.length) throw projectError(409, "PROJECT_CUSTOMER_CHANGE_BLOCKED", review.blocking.map((row) => row.message).join(" "), { review });
  if (review.warnings.length && !input.acknowledgeWarnings) throw projectError(409, "PROJECT_DEPENDENCIES_EXIST", "Review what the change touches, then confirm.", { review });
  if (!approvalNeeded(project, settings)) {
    await applyCustomerChange(client, c, project, target, contact, reason || null);
    return { projectId: project.id, status: "APPLIED", customerId: target.id };
  }
  const id = randomUUID();
  await client.query(`INSERT INTO tenant.project_customer_change_requests (id, organization_id, project_id, from_customer_id, to_customer_id, to_contact_id, project_status, reason, review,
      requested_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
    [id, c.organizationId, project.id, project.customer_id, target.id, contact?.id ?? null, project.status, reason, JSON.stringify(review), c.userId ?? null, key]);
  await customerEvent(client, c, project.id, "CUSTOMER_CHANGE_REQUESTED", `Change of customer to ${target.display_name} requested`, { fromCustomerId: project.customer_id, toCustomerId: target.id, reason });
  await projectEvent(client, c, project.id, "CUSTOMER_CHANGE_REQUESTED", `Customer change to ${target.display_name} waiting for approval: ${reason}`);
  await notifyProject(client, c, project, [project.manager_user_id], { title: `${project.project_code}: customer change requested`, message: `To ${target.display_name}: ${reason}` });
  return { requestId: id, projectId: project.id, status: "PENDING" };
}
// input: { decision: APPROVE | REJECT, note? } — someone who may change customers and approve projects, other than the requester (unless the
// company allows self-approval). Approval re-checks the dependencies at that moment.
export async function decideProjectCustomerChange(client, c, projectId, requestId, input = {}) {
  const { project, can } = await projectFor(client, c, projectId, null, { lock: true });
  if (!can.approve) throw projectError(403, "PROJECT_CUSTOMER_PERMISSION_DENIED", "You may not approve customer changes.");
  const request = (await client.query(`SELECT * FROM tenant.project_customer_change_requests WHERE organization_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
    [c.organizationId, project.id, uuid(requestId, "Change request")])).rows[0];
  if (!request) throw projectError(404, "PROJECT_NOT_FOUND", "That change request was not found.");
  if (request.status !== "PENDING") return { requestId: request.id, status: request.status, replayed: true };
  const settings = await projectSettings(client, c);
  if (request.requested_by === c.userId && !settings.selfApprovalAllowed) throw projectError(403, "PROJECT_CUSTOMER_APPROVAL_REQUIRED", "Someone other than the requester approves a customer change.");
  const decision = String(input.decision ?? "").toUpperCase();
  const note = text(input.note, 1000) || null;
  const target = await partyRow(client, c, request.to_customer_id);
  if (decision === "REJECT") {
    if (!note || note.length < 3) throw projectError(400, "PROJECT_REASON_REQUIRED", "Say why the change is not approved.");
    await client.query(`UPDATE tenant.project_customer_change_requests SET status = 'REJECTED', decided_by = $2, decided_at = clock_timestamp(), decision_note = $3 WHERE id = $1`, [request.id, c.userId ?? null, note]);
    await customerEvent(client, c, project.id, "CUSTOMER_CHANGE_REJECTED", `Change of customer to ${target?.display_name} not approved`, { toCustomerId: request.to_customer_id, reason: note });
    await notifyProject(client, c, project, [request.requested_by, project.manager_user_id], { title: `${project.project_code}: customer change not approved`, message: note });
    return { requestId: request.id, status: "REJECTED" };
  }
  if (decision !== "APPROVE") throw projectError(400, "PROJECT_INPUT_INVALID", "Approve or reject.");
  const valid = await customerRecord(client, c, request.to_customer_id, { purpose: "new", settings });
  const review = await changeReview(client, c, project, valid);
  if (review.blocking.length) throw projectError(409, "PROJECT_CUSTOMER_CHANGE_BLOCKED", review.blocking.map((row) => row.message).join(" "), { review });
  const contact = request.to_contact_id ? await contactRecord(client, c, request.to_contact_id, valid.id).catch(() => null) : null;
  await client.query(`UPDATE tenant.project_customer_change_requests SET status = 'APPLIED', decided_by = $2, decided_at = clock_timestamp(), decision_note = $3 WHERE id = $1`, [request.id, c.userId ?? null, note]);
  await customerEvent(client, c, project.id, "CUSTOMER_CHANGE_APPROVED", `Change of customer to ${valid.display_name} approved`, { toCustomerId: valid.id, reason: note });
  await applyCustomerChange(client, c, project, valid, contact, request.reason, request.requested_by);
  return { requestId: request.id, status: "APPLIED", customerId: valid.id };
}
export async function withdrawProjectCustomerChange(client, c, projectId, requestId) {
  const { project, can } = await projectFor(client, c, projectId, null, { lock: true });
  const request = (await client.query(`SELECT * FROM tenant.project_customer_change_requests WHERE organization_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
    [c.organizationId, project.id, uuid(requestId, "Change request")])).rows[0];
  if (!request) throw projectError(404, "PROJECT_NOT_FOUND", "That change request was not found.");
  if (request.status !== "PENDING") return { requestId: request.id, status: request.status, replayed: true };
  if (request.requested_by !== c.userId && !can.change) throw projectError(403, "PROJECT_CUSTOMER_PERMISSION_DENIED");
  await client.query(`UPDATE tenant.project_customer_change_requests SET status = 'WITHDRAWN', decided_by = $2, decided_at = clock_timestamp() WHERE id = $1`, [request.id, c.userId ?? null]);
  await customerEvent(client, c, project.id, "CUSTOMER_CHANGE_WITHDRAWN", "Customer change request withdrawn", { toCustomerId: request.to_customer_id });
  return { requestId: request.id, status: "WITHDRAWN" };
}
// The change itself: the project's customer, its contacts and primary contact; every linked sales and finance document stays as it was.
async function applyCustomerChange(client, c, project, target, contact, reason, requestedBy = null) {
  const from = project.customer_id ? await partyRow(client, c, project.customer_id) : null;
  await client.query(`UPDATE tenant.projects SET customer_id = $3, crm_account_id = NULL, row_version = row_version + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, project.id, target.id, c.userId ?? null]);
  const removed = await removeContactsNotOf(client, c, project, target.id, `Not a contact of ${target.display_name}`);
  for (const row of removed) await customerEvent(client, c, project.id, "CONTACT_REMOVED", "A contact of the previous customer left the project", { contactId: row.contact_id });
  if (contact) await setPrimaryContactRow(client, c, project, contact.id);
  await customerEvent(client, c, project.id, "CUSTOMER_REASSIGNED", `Customer changed from ${from?.display_name ?? "none"} to ${target.display_name}`,
    { fromCustomerId: project.customer_id, toCustomerId: target.id, reason, details: { projectStatus: project.status, contactsRemoved: removed.length } });
  await projectEvent(client, c, project.id, "CUSTOMER_CHANGED", `Customer: ${from?.display_name ?? "none"} → ${target.display_name}${reason ? `: ${reason}` : ""}`);
  await notifyProject(client, c, project, [project.manager_user_id, requestedBy, ...await activeMemberIds(client, c, project.id)], { title: `${project.project_code}: customer changed`,
    message: `The customer is now ${target.display_name}.` });
  await publishProjectEvent(client, c, project, "customer_changed", { fromCustomerId: project.customer_id, toCustomerId: target.id });
}

// ------------------------------------------------------------------ when the owning masters change
async function flagReview(client, c, project, reason) {
  await client.query(`UPDATE tenant.projects SET customer_review_required = true, customer_review_reason = $3, customer_review_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, project.id, reason.slice(0, 1000)]);
  await customerEvent(client, c, project.id, "REVIEW_FLAGGED", reason);
}
// input: { note } — the project manager has reviewed the commercial change.
export async function clearProjectCustomerReview(client, c, projectId, input = {}) {
  const { project, can } = await projectFor(client, c, projectId, null, { lock: true });
  if (!can.review) throw projectError(403, "PROJECT_CUSTOMER_PERMISSION_DENIED");
  if (!project.customer_review_required) return { projectId: project.id, replayed: true };
  const note = text(input.note, 1000);
  if (note.length < 3) throw projectError(400, "PROJECT_REASON_REQUIRED", "Say what was reviewed.");
  await client.query(`UPDATE tenant.projects SET customer_review_required = false, customer_review_reason = NULL, customer_review_at = NULL WHERE organization_id = $1 AND id = $2`, [c.organizationId, project.id]);
  await customerEvent(client, c, project.id, "REVIEW_CLEARED", `Reviewed: ${note}`, { reason: note });
  return { projectId: project.id };
}
// CRM merged a duplicate account into the account it keeps (in CRM's transaction). A draft that referenced the duplicate as its provisional CRM
// account now references the kept one — and takes it as its customer when the kept account is a Customer; the association history keeps the
// original. A project whose customer was the duplicate (CRM does not merge customers away) is flagged for review rather than changed.
export async function applyProjectCustomerMerge(client, c, duplicateId, survivorId) {
  const survivor = await partyRow(client, c, survivorId);
  const duplicate = await partyRow(client, c, duplicateId);
  const projects = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND deleted_at IS NULL AND (crm_account_id = $2 OR customer_id = $2) FOR UPDATE`,
    [c.organizationId, duplicateId])).rows;
  for (const project of projects) {
    if (project.customer_id === duplicateId) {
      await flagReview(client, c, project, `${duplicate?.display_name} was merged into ${survivor?.display_name}: confirm the project's customer.`);
      await notifyProject(client, c, project, [project.manager_user_id], { title: `${project.project_code}: customer merged`, message: `${duplicate?.display_name} was merged into ${survivor?.display_name}. Review the project's customer.` });
      continue;
    }
    const resolves = isCustomerParty(survivor);
    await client.query(`UPDATE tenant.projects SET crm_account_id = $3, customer_id = $4, row_version = row_version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, project.id, resolves ? null : survivorId, resolves ? survivorId : null]);
    await customerEvent(client, c, project.id, "CUSTOMER_MERGED", `${duplicate?.display_name} was merged into ${survivor?.display_name}`, { fromCustomerId: duplicateId, toCustomerId: survivorId });
    if (resolves) await customerEvent(client, c, project.id, "CRM_MAPPING_RESOLVED", `${survivor.display_name} is the customer (the CRM account now maps to this Customer)`, { fromCustomerId: duplicateId, toCustomerId: survivorId });
    await notifyProject(client, c, project, [project.manager_user_id], { title: `${project.project_code}: customer account merged`,
      message: resolves ? `${duplicate?.display_name} now maps to the customer ${survivor.display_name}.` : `${duplicate?.display_name} was merged into ${survivor?.display_name}.` });
  }
  // Links to the duplicate account follow it (a project never holds the same link twice).
  const links = (await client.query(`SELECT * FROM tenant.project_links WHERE organization_id = $1 AND source_type = 'CRM_ACCOUNT' AND source_id = $2 AND removed_at IS NULL FOR UPDATE`, [c.organizationId, duplicateId])).rows;
  for (const link of links) {
    const twin = (await client.query(`SELECT 1 FROM tenant.project_links WHERE project_id = $1 AND source_type = 'CRM_ACCOUNT' AND source_id = $2 AND removed_at IS NULL`, [link.project_id, survivorId])).rows[0];
    await client.query(`UPDATE tenant.project_links SET removed_at = clock_timestamp(), removed_by = $2 WHERE id = $1`, [link.id, c.userId ?? null]);
    if (!twin) {
      await client.query(`INSERT INTO tenant.project_links (organization_id, project_id, source_module, source_type, source_id, link_type, note, created_by) VALUES ($1,$2,'CRM','CRM_ACCOUNT',$3,$4,$5,$6)`,
        [c.organizationId, link.project_id, survivorId, link.link_type, link.note, c.userId ?? null]);
    }
  }
  return { projects: projects.length, links: links.length };
}
// CRM merged a duplicate contact into the one it keeps: a project's role held by the duplicate is held by the kept person (the history keeps
// the original); a kept person who is not the project's customer's contact flags the project for review.
export async function applyProjectContactMerge(client, c, duplicateId, survivorId) {
  const rows = (await client.query(`SELECT row.*, project.customer_id, project.crm_account_id, project.manager_user_id, project.project_code FROM tenant.project_customer_contacts row
      JOIN tenant.projects project ON project.id = row.project_id WHERE row.organization_id = $1 AND row.contact_id = $2 AND row.status = 'ACTIVE' FOR UPDATE OF row`, [c.organizationId, duplicateId])).rows;
  for (const row of rows) {
    await client.query(`UPDATE tenant.project_customer_contacts SET status = 'REMOVED', removed_at = clock_timestamp(), removed_by = $2, removal_note = 'Merged into another contact', row_version = row_version + 1 WHERE id = $1`,
      [row.id, c.userId ?? null]);
    await client.query(`INSERT INTO tenant.project_customer_contacts (organization_id, project_id, contact_id, role, title, added_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [c.organizationId, row.project_id, survivorId, row.role, row.title, c.userId ?? null]);
    if (row.role === "PRIMARY") await syncPrimaryContact(client, c, row.project_id);
    await customerEvent(client, c, row.project_id, "CONTACT_MERGED", "A project contact was merged into another contact record", { contactId: survivorId, details: { mergedContactId: duplicateId } });
    const party = row.customer_id ?? row.crm_account_id;
    const related = party && (await client.query(`SELECT 1 FROM tenant.contacts contact WHERE contact.id = $1 AND (contact.party_id = $2 OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships relation
        WHERE relation.contact_id = contact.id AND relation.party_id = $2 AND relation.status = 'active'))`, [survivorId, party])).rows[0];
    if (!related) await flagReview(client, c, { id: row.project_id }, "A contact was merged into a record that is not the customer's contact: review the project's contacts.");
  }
  return { rows: rows.length };
}
// Sales recorded a change to an order (in Sales' transaction). A project delivering that order hears of it: a cancellation or a quantity
// cancelled flags it for review (the project is never deleted or changed), an amendment is shown on its timeline, and an order that now
// belongs to another customer is flagged as a mismatch.
const ORDER_EVENTS = Object.freeze({ "sales_order.cancelled": "was cancelled", "sales_order.quantity_cancelled": "had quantity cancelled", "sales_order.updated": "was amended",
  "sales_order.reopened": "was reopened for changes" });
export async function noteSalesOrderChangeForProjects(client, c, orderId, eventType, metadata = {}) {
  if (!ORDER_EVENTS[eventType]) return { projects: 0 };
  const rows = (await client.query(
    `SELECT DISTINCT ON (project.id) project.*, sales_order.sales_order_number, sales_order.party_id AS order_party_id FROM tenant.project_links link
       JOIN tenant.projects project ON project.id = link.project_id JOIN tenant.sales_orders sales_order ON sales_order.id = link.source_id
      WHERE link.organization_id = $1 AND link.source_type = 'SALES_ORDER' AND link.source_id = $2 AND link.removed_at IS NULL AND project.deleted_at IS NULL
        AND project.status <> 'CANCELLED'`, [c.organizationId, orderId])).rows;
  for (const project of rows) {
    const what = `${project.sales_order_number} ${ORDER_EVENTS[eventType]}`;
    const mismatch = projectParty(project) && project.order_party_id !== projectParty(project);
    await customerEvent(client, c, project.id, "SALES_RECORD_CHANGED", what, { details: { orderId, eventType, changes: metadata.changes ?? null, reason: metadata.reason ?? null } });
    await projectEvent(client, c, project.id, "SALES_ORDER_CHANGED", what);
    if (mismatch) await flagReview(client, c, project, `${project.sales_order_number} now belongs to another customer: unlink it or review the project's customer.`);
    else if (["sales_order.cancelled", "sales_order.quantity_cancelled", "sales_order.reopened"].includes(eventType)) await flagReview(client, c, project, `${what}: review the project's scope and plan.`);
    await notifyProject(client, c, project, [project.manager_user_id], { title: `${project.project_code}: ${what}`,
      message: mismatch ? "The order now belongs to another customer." : eventType === "sales_order.updated" ? "Review whether the project's scope changes (nothing changed automatically)." : "Review the project; it was not changed." });
  }
  return { projects: rows.length };
}

// ------------------------------------------------------------------ the customer's side, history, export and reports
// The projects of a customer (and of its CRM account before it became one) the person may see, with the counts the customer record shows.
export async function getCustomerProjects(client, c, customerId) {
  if (!canView(c)) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  const id = uuid(customerId, "Customer");
  const rows = (await client.query(
    `SELECT project.id, project.project_code, project.name, project.status, project.classification, project.target_end_date, project.customer_id, project.crm_account_id,
            project.customer_review_required, manager.full_name AS manager_name, manager.email AS manager_email
       FROM tenant.projects project LEFT JOIN public.users manager ON manager.id = project.manager_user_id
      WHERE project.organization_id = $1 AND project.deleted_at IS NULL AND (project.customer_id = $2 OR project.crm_account_id = $2) AND ${visibilitySql(c, "project", "$3")}
      ORDER BY project.created_at DESC LIMIT 500`, [c.organizationId, id, c.userId ?? "00000000-0000-0000-0000-000000000000"])).rows;
  const count = (predicate) => rows.filter(predicate).length;
  return {
    summary: { total: rows.length, active: count((row) => ["PLANNED", "IN_PROGRESS"].includes(row.status)), onHold: count((row) => row.status === "ON_HOLD"), drafts: count((row) => row.status === "DRAFT"),
      completed: count((row) => row.status === "COMPLETED"), cancelled: count((row) => row.status === "CANCELLED"), needsReview: count((row) => row.customer_review_required) },
    projects: rows.map((row) => ({ id: row.id, code: row.project_code, name: row.name, status: row.status, statusLabel: STATUS_LABEL[row.status], targetEndDate: row.target_end_date,
      manager: row.manager_name || row.manager_email || null, provisional: !row.customer_id, needsReview: row.customer_review_required, href: `/projects/${row.id}` })),
    complete: seesAll(c),
  };
}
export async function getCustomerAssociationHistory(client, c, projectId) {
  const { project } = await projectFor(client, c, projectId, "history");
  const rows = (await client.query(`SELECT event.*, from_party.display_name AS from_name, to_party.display_name AS to_name, ${NAME_SQL} AS contact_name
      FROM tenant.project_customer_events event
      LEFT JOIN tenant.business_parties from_party ON from_party.id = event.from_customer_id LEFT JOIN tenant.business_parties to_party ON to_party.id = event.to_customer_id
      LEFT JOIN tenant.contacts contact ON contact.id = event.contact_id
     WHERE event.organization_id = $1 AND event.project_id = $2 ORDER BY event.occurred_at DESC LIMIT 500`, [c.organizationId, project.id])).rows;
  const names = await userNames(client, rows.map((row) => row.actor_user_id));
  return rows.map((row) => ({ id: row.id, type: row.event_type, summary: row.summary, reason: row.reason, from: row.from_name, to: row.to_name, contact: row.contact_name,
    actor: names.get(row.actor_user_id) ?? "System", at: row.occurred_at }));
}
// The association rows (customer, primary contact, primary site, linked sales orders) of the projects the person may see.
async function associationRows(client, c, filters = {}) {
  const values = [c.organizationId, c.userId ?? "00000000-0000-0000-0000-000000000000"];
  const where = ["project.organization_id = $1", "project.deleted_at IS NULL", "project.classification = 'CUSTOMER'", visibilitySql(c, "project", "$2")];
  if (filters.customerId) { values.push(uuid(filters.customerId, "Customer")); where.push(`(project.customer_id = $${values.length} OR project.crm_account_id = $${values.length})`); }
  return (await client.query(
    `SELECT project.id, project.project_code, project.name, project.status, project.customer_id, project.crm_account_id, project.customer_review_required, project.customer_review_reason,
            project.manager_user_id, manager.full_name AS manager_name, party.display_name AS customer_name, party.customer_number, party.status AS customer_status,
            primary_contact.name AS primary_contact, site.city AS site_city, site.site_name,
            (SELECT count(*)::int FROM tenant.project_customer_contacts row WHERE row.project_id = project.id AND row.status = 'ACTIVE') AS contacts,
            (SELECT string_agg(DISTINCT sales_order.sales_order_number, ', ') FROM tenant.project_links link JOIN tenant.sales_orders sales_order ON sales_order.id = link.source_id
              WHERE link.project_id = project.id AND link.removed_at IS NULL AND link.source_type = 'SALES_ORDER') AS sales_orders
       FROM tenant.projects project
       LEFT JOIN public.users manager ON manager.id = project.manager_user_id
       LEFT JOIN tenant.business_parties party ON party.id = COALESCE(project.customer_id, project.crm_account_id)
       LEFT JOIN LATERAL (SELECT ${NAME_SQL} AS name FROM tenant.project_customer_contacts row JOIN tenant.contacts contact ON contact.id = row.contact_id
                           WHERE row.project_id = project.id AND row.role = 'PRIMARY' AND row.status = 'ACTIVE' LIMIT 1) primary_contact ON true
       LEFT JOIN LATERAL (SELECT site.city, site.site_name FROM tenant.project_customer_sites site WHERE site.project_id = project.id AND site.status = 'ACTIVE' ORDER BY site.is_primary DESC LIMIT 1) site ON true
      WHERE ${where.join(" AND ")} ORDER BY party.display_name NULLS LAST, project.project_code`, values)).rows;
}
export async function exportProjectCustomers(client, c, filters = {}) {
  if (!has(c, PROJECT.customerExport)) throw projectError(403, "PROJECT_CUSTOMER_PERMISSION_DENIED");
  const rows = await associationRows(client, c, filters);
  const cell = (value) => { const raw = value === null || value === undefined ? "" : String(value); return /[",\n\r]/.test(raw) || /^[=+\-@]/.test(raw) ? `"${(/^[=+\-@]/.test(raw) ? `'${raw}` : raw).replace(/"/g, "\"\"")}"` : raw; };
  const header = ["Project", "Name", "Status", "Customer", "Customer number", "Customer status", "Provisional CRM account", "Primary contact", "Contacts", "Primary site", "Sales orders", "Needs review"];
  const lines = rows.map((row) => [row.project_code, row.name, STATUS_LABEL[row.status], row.customer_name, row.customer_number, row.customer_status, row.customer_id ? "" : "yes",
    row.primary_contact, row.contacts, row.site_name ? `${row.site_name}, ${row.site_city}` : "", row.sales_orders, row.customer_review_required ? "yes" : ""].map(cell).join(","));
  return { fileName: `project-customers-${await today(client)}.csv`, csv: [header.join(","), ...lines].join("\r\n"), count: rows.length };
}
export const CUSTOMER_REPORTS = Object.freeze(["customer-count", "customer-active", "customer-completed", "customer-managers", "customer-status", "sales-linked",
  "missing-primary-contact", "customer-mismatch", "customer-reassignments", "customer-summary"]);
// Customer reports over the projects the person may see (so they agree with the directory and the association itself).
export async function getProjectCustomerReport(client, c, kind) {
  if (!has(c, PROJECT.reports) || !has(c, PROJECT.customerView)) throw projectError(403, "PROJECT_CUSTOMER_PERMISSION_DENIED");
  const rows = await associationRows(client, c);
  const byCustomer = (filter) => {
    const map = new Map();
    for (const row of rows.filter(filter)) {
      const key = row.customer_id ?? row.crm_account_id ?? "—";
      const entry = map.get(key) ?? { key, label: row.customer_name ?? "No customer yet", number: row.customer_number, total: 0, active: 0, onHold: 0, completed: 0, drafts: 0, cancelled: 0 };
      entry.total += 1;
      if (["PLANNED", "IN_PROGRESS"].includes(row.status)) entry.active += 1; else if (row.status === "ON_HOLD") entry.onHold += 1; else if (row.status === "COMPLETED") entry.completed += 1;
      else if (row.status === "DRAFT") entry.drafts += 1; else entry.cancelled += 1;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label)));
  };
  const projectRow = (row) => ({ id: row.id, code: row.project_code, name: row.name, status: row.status, statusLabel: STATUS_LABEL[row.status], customer: row.customer_name,
    customerNumber: row.customer_number, customerStatus: row.customer_status, manager: row.manager_name, primaryContact: row.primary_contact, salesOrders: row.sales_orders,
    site: row.site_name ? `${row.site_name}, ${row.site_city}` : null, review: row.customer_review_reason });
  switch (kind) {
    case "customer-count": return byCustomer(() => true);
    case "customer-active": return rows.filter((row) => ACTIVE_STATUSES.includes(row.status)).map(projectRow);
    case "customer-completed": return rows.filter((row) => row.status === "COMPLETED").map(projectRow);
    case "customer-managers": {
      const map = new Map();
      for (const row of rows) {
        const key = `${row.customer_id ?? row.crm_account_id}:${row.manager_user_id}`;
        const entry = map.get(key) ?? { key, customer: row.customer_name, manager: row.manager_name ?? "No manager", projects: 0, active: 0 };
        entry.projects += 1;
        if (ACTIVE_STATUSES.includes(row.status)) entry.active += 1;
        map.set(key, entry);
      }
      return [...map.values()].sort((a, b) => String(a.customer).localeCompare(String(b.customer)));
    }
    case "customer-status": return byCustomer(() => true);
    case "sales-linked": return rows.filter((row) => row.sales_orders).map(projectRow);
    case "missing-primary-contact": return rows.filter((row) => !row.primary_contact && row.status !== "CANCELLED").map(projectRow);
    case "customer-mismatch": {
      const out = [];
      for (const row of rows) {
        const mismatches = projectParty(row) ? await mismatchedLinks(client, c, row, projectParty(row)) : [];
        if (mismatches.length || (row.customer_review_required && /another customer/.test(row.customer_review_reason ?? ""))) {
          out.push({ ...projectRow(row), mismatches: mismatches.map((item) => item.label) });
        }
      }
      return out;
    }
    case "customer-reassignments": {
      if (!has(c, PROJECT.customerHistory)) throw projectError(403, "PROJECT_CUSTOMER_PERMISSION_DENIED");
      const ids = rows.map((row) => row.id);
      if (!ids.length) return [];
      const events = (await client.query(`SELECT event.*, project.project_code, from_party.display_name AS from_name, to_party.display_name AS to_name FROM tenant.project_customer_events event
          JOIN tenant.projects project ON project.id = event.project_id LEFT JOIN tenant.business_parties from_party ON from_party.id = event.from_customer_id
          LEFT JOIN tenant.business_parties to_party ON to_party.id = event.to_customer_id
         WHERE event.organization_id = $1 AND event.project_id = ANY($2::uuid[]) AND event.event_type IN ('CUSTOMER_REASSIGNED', 'CUSTOMER_CHANGE_REQUESTED', 'CUSTOMER_CHANGE_REJECTED', 'CUSTOMER_MERGED', 'CRM_MAPPING_RESOLVED')
         ORDER BY event.occurred_at DESC LIMIT 500`, [c.organizationId, ids])).rows;
      const names = await userNames(client, events.map((row) => row.actor_user_id));
      return events.map((row) => ({ projectId: row.project_id, code: row.project_code, type: row.event_type, from: row.from_name, to: row.to_name, reason: row.reason, actor: names.get(row.actor_user_id) ?? "System", at: row.occurred_at }));
    }
    case "customer-summary": {
      const summary = byCustomer(() => true);
      return summary.map((entry) => ({ ...entry, needsReview: rows.filter((row) => (row.customer_id ?? row.crm_account_id ?? "—") === entry.key && row.customer_review_required).length,
        missingPrimaryContact: rows.filter((row) => (row.customer_id ?? row.crm_account_id ?? "—") === entry.key && !row.primary_contact && row.status !== "CANCELLED").length }));
    }
    default: throw projectError(400, "PROJECT_INPUT_INVALID", "Choose a project report.");
  }
}
export { LINK_SOURCES as PROJECT_LINK_SOURCES, linkLabel };
