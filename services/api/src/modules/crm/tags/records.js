// Tags on leads, deals, companies and contacts (CRM plan 3.4; companies and contacts: CRM audit): the organization's shared labels, many
// per record. Whoever may edit the record may tag it,
// and may make a new tag while doing so; renaming, recolouring and deleting tags is for whoever manages CRM settings. A converted lead's
// tags go on to its deal.
import { CrmError } from "../data-management/errors.js";
import { requireLeadPermission } from "../leads/access.js";
import { LEAD_PERMISSIONS } from "../leads/constants.js";
import { getLead } from "../leads/records.js";
import { requireOpportunityPermission } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";
import { getOpportunity } from "../opportunities/records.js";
import { getAccount } from "../accounts/records.js";
import { getContact } from "../contacts/records.js";
import { copyLeadTagsToDeal, tagsByRecord } from "./lookup.js";

export const TAG_COLORS = Object.freeze(["neutral", "blue", "green", "amber", "red", "purple", "teal"]);
const MANAGE = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const invalid = (field, message) => new CrmError(400, message, "CRM_TAG_VALIDATION", { issues: [{ field, message }] });
const toTag = (row) => ({ id: row.id, name: row.name, color: row.color,
  ...(row.lead_count !== undefined ? { leadCount: row.lead_count, dealCount: row.deal_count, companyCount: row.company_count, contactCount: row.contact_count } : {}) });
export { copyLeadTagsToDeal, tagsByRecord };

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to manage tags.", "PERMISSION_DENIED");
}

export async function listTags(client, context, { withCounts = false } = {}) {
  const counts = withCounts
    ? `, (SELECT count(*)::int FROM tenant.crm_record_tags used WHERE used.tag_id = tag.id AND used.entity_type = 'lead') AS lead_count,
         (SELECT count(*)::int FROM tenant.crm_record_tags used WHERE used.tag_id = tag.id AND used.entity_type = 'opportunity') AS deal_count,
         (SELECT count(*)::int FROM tenant.crm_record_tags used WHERE used.tag_id = tag.id AND used.entity_type = 'party') AS company_count,
         (SELECT count(*)::int FROM tenant.crm_record_tags used WHERE used.tag_id = tag.id AND used.entity_type = 'contact') AS contact_count`
    : "";
  const { rows } = await client.query(`SELECT tag.*${counts} FROM tenant.crm_tags tag WHERE tag.organization_id = $1 ORDER BY lower(tag.name)`, [context.organizationId]);
  return rows.map(toTag);
}

// Finds a tag by name, making it when it does not exist.
async function tagNamed(client, context, name) {
  const clean = text(name).slice(0, 60);
  if (!clean) throw invalid("tags", "A tag needs a name.");
  const found = (await client.query("SELECT * FROM tenant.crm_tags WHERE organization_id = $1 AND lower(name) = lower($2)", [context.organizationId, clean])).rows[0];
  if (found) return found;
  return (await client.query(
    `INSERT INTO tenant.crm_tags (organization_id, name, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, lower(name)) DO UPDATE SET updated_at = tenant.crm_tags.updated_at RETURNING *`,
    [context.organizationId, clean, context.userId ?? null])).rows[0];
}

async function requireTaggable(client, context, entityType, entityId) {
  if (entityType === "lead") {
    requireLeadPermission(context, LEAD_PERMISSIONS.edit, "You do not have permission to edit this lead.");
    return getLead(client, context, entityId);
  }
  if (entityType === "opportunity") {
    requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to edit this deal.");
    return getOpportunity(client, context, entityId);
  }
  if (entityType === "party") {
    if (!(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes("crm.accounts.edit"))) throw new CrmError(403, "You do not have permission to edit this company.", "PERMISSION_DENIED");
    return getAccount(client, context, entityId);
  }
  if (entityType === "contact") {
    if (!(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes("crm.contacts.edit"))) throw new CrmError(403, "You do not have permission to edit this contact.", "PERMISSION_DENIED");
    return getContact(client, context, entityId);
  }
  throw invalid("entityType", "Tags go on leads, deals, companies and contacts.");
}

// Sets a record's tags to exactly these: tags: [{ id } | { name } | "name"]. Returns the record's tags.
export async function setRecordTags(client, context, entityType, entityId, tags = []) {
  await requireTaggable(client, context, entityType, entityId);
  if (!Array.isArray(tags)) throw invalid("tags", "Give the tags as a list.");
  if (tags.length > 20) throw invalid("tags", "A record takes at most 20 tags.");
  const ids = [];
  for (const entry of tags) {
    const id = typeof entry === "object" && entry ? entry.id : null;
    if (id) {
      if (!UUID.test(String(id)) || !(await client.query("SELECT 1 FROM tenant.crm_tags WHERE organization_id = $1 AND id = $2", [context.organizationId, id])).rows[0])
        throw invalid("tags", "One of the tags no longer exists.");
      ids.push(id);
    } else {
      ids.push((await tagNamed(client, context, typeof entry === "object" && entry ? entry.name : entry)).id);
    }
  }
  const unique = [...new Set(ids)];
  await client.query("DELETE FROM tenant.crm_record_tags WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND NOT (tag_id = ANY($4::uuid[]))",
    [context.organizationId, entityType, entityId, unique]);
  for (const id of unique)
    await client.query(`INSERT INTO tenant.crm_record_tags (organization_id, tag_id, entity_type, entity_id, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [context.organizationId, id, entityType, entityId, context.userId ?? null]);
  return (await tagsByRecord(client, context.organizationId, entityType, [entityId])).get(entityId) ?? [];
}

export async function createTag(client, context, input = {}) {
  requireManage(context);
  const name = text(input.name).slice(0, 60);
  if (!name) throw invalid("name", "Name the tag.");
  if ((await client.query("SELECT 1 FROM tenant.crm_tags WHERE organization_id = $1 AND lower(name) = lower($2)", [context.organizationId, name])).rows[0]) throw invalid("name", "This tag already exists.");
  const color = TAG_COLORS.includes(input.color) ? input.color : "neutral";
  const row = (await client.query("INSERT INTO tenant.crm_tags (organization_id, name, color, created_by) VALUES ($1, $2, $3, $4) RETURNING *",
    [context.organizationId, name, color, context.userId ?? null])).rows[0];
  return toTag(row);
}

export async function updateTag(client, context, tagId, input = {}) {
  requireManage(context);
  if (!UUID.test(String(tagId ?? ""))) throw new CrmError(404, "Tag not found.", "CRM_TAG_NOT_FOUND");
  const row = (await client.query("SELECT * FROM tenant.crm_tags WHERE organization_id = $1 AND id = $2", [context.organizationId, tagId])).rows[0];
  if (!row) throw new CrmError(404, "Tag not found.", "CRM_TAG_NOT_FOUND");
  const name = input.name === undefined ? row.name : text(input.name).slice(0, 60);
  if (!name) throw invalid("name", "Name the tag.");
  if (name.toLowerCase() !== row.name.toLowerCase()
    && (await client.query("SELECT 1 FROM tenant.crm_tags WHERE organization_id = $1 AND lower(name) = lower($2)", [context.organizationId, name])).rows[0])
    throw invalid("name", "Another tag already has this name.");
  const color = input.color === undefined ? row.color : input.color;
  if (!TAG_COLORS.includes(color)) throw invalid("color", "Choose a colour from the list.");
  const updated = (await client.query("UPDATE tenant.crm_tags SET name = $3, color = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *",
    [context.organizationId, row.id, name, color])).rows[0];
  return toTag(updated);
}

// Deleting a tag takes it off every record that has it.
export async function deleteTag(client, context, tagId) {
  requireManage(context);
  if (!UUID.test(String(tagId ?? ""))) throw new CrmError(404, "Tag not found.", "CRM_TAG_NOT_FOUND");
  const { rowCount } = await client.query("DELETE FROM tenant.crm_tags WHERE organization_id = $1 AND id = $2", [context.organizationId, tagId]);
  if (!rowCount) throw new CrmError(404, "Tag not found.", "CRM_TAG_NOT_FOUND");
  return { deleted: true };
}
