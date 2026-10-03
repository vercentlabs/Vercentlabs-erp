// Lead sources: where a lead came from. Every organization starts with the
// standard list; administrators (crm.settings.manage) can add, rename and
// deactivate sources. A source is never deleted, so leads and the
// opportunities converted from them keep their source for reporting.
import { CrmError } from "../data-management/errors.js";
import { requireLeadPermission } from "./access.js";
import { DEFAULT_LEAD_SOURCES } from "./constants.js";
import { requireUuid } from "./validation.js";

const SETTINGS_PERMISSION = "crm.settings.manage";

function toSource(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.status === "active",
    isSystem: row.is_system,
    sortOrder: row.sort_order,
    leadCount: row.lead_count === undefined ? undefined : Number(row.lead_count),
  };
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "source";
}

function sourceName(value) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 120) throw new CrmError(400, "Enter a source name of up to 120 characters.", "CRM_LEAD_SOURCE_VALIDATION");
  return name;
}

// Idempotent: adds the standard sources an organization does not have yet.
export async function ensureDefaultLeadSources(client, context) {
  const existing = await client.query(`SELECT 1 FROM tenant.crm_lead_sources WHERE organization_id = $1 LIMIT 1`, [context.organizationId]);
  if (existing.rows[0]) return;
  for (const [index, source] of DEFAULT_LEAD_SOURCES.entries()) {
    await client.query(
      `INSERT INTO tenant.crm_lead_sources (organization_id, code, name, channel, is_system, sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, true, $5, $6, $6) ON CONFLICT DO NOTHING`,
      [context.organizationId, source.code, source.name, source.channel, (index + 1) * 10, context.userId ?? null],
    );
  }
}

export async function listLeadSources(client, context, { includeInactive = false } = {}) {
  await ensureDefaultLeadSources(client, context);
  const { rows } = await client.query(
    `SELECT source.*, (SELECT count(*) FROM tenant.crm_leads lead
                        WHERE lead.organization_id = source.organization_id AND lead.source_id = source.id) AS lead_count
       FROM tenant.crm_lead_sources source
      WHERE source.organization_id = $1 AND ($2 OR source.status = 'active')
      ORDER BY source.sort_order, lower(source.name)`,
    [context.organizationId, includeInactive],
  );
  return rows.map(toSource);
}

export async function createLeadSource(client, context, input = {}) {
  requireLeadPermission(context, SETTINGS_PERMISSION, "You do not have permission to manage lead sources.");
  const name = sourceName(input.name);
  const duplicate = await client.query(
    `SELECT 1 FROM tenant.crm_lead_sources WHERE organization_id = $1 AND lower(btrim(name)) = lower($2)`,
    [context.organizationId, name],
  );
  if (duplicate.rows[0]) throw new CrmError(409, "A lead source with this name already exists.", "CRM_LEAD_SOURCE_DUPLICATE");
  const base = slug(name);
  const taken = new Set((await client.query(
    `SELECT code FROM tenant.crm_lead_sources WHERE organization_id = $1 AND code LIKE $2`,
    [context.organizationId, `${base}%`],
  )).rows.map((row) => row.code));
  let code = base;
  for (let suffix = 2; taken.has(code); suffix += 1) code = `${base}_${suffix}`;
  const { rows } = await client.query(
    `INSERT INTO tenant.crm_lead_sources (organization_id, code, name, description, sort_order, created_by, updated_by)
     VALUES ($1, $2, $3, $4, COALESCE((SELECT max(sort_order) + 10 FROM tenant.crm_lead_sources WHERE organization_id = $1), 10), $5, $5)
     RETURNING *`,
    [context.organizationId, code, name, String(input.description ?? "").trim().slice(0, 500) || null, context.userId],
  );
  return toSource(rows[0]);
}

export async function updateLeadSource(client, context, id, input = {}) {
  requireLeadPermission(context, SETTINGS_PERMISSION, "You do not have permission to manage lead sources.");
  const sourceId = requireUuid(id, "Lead source");
  const current = (await client.query(
    `SELECT * FROM tenant.crm_lead_sources WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, sourceId],
  )).rows[0];
  if (!current) throw new CrmError(404, "Lead source not found.", "CRM_LEAD_SOURCE_NOT_FOUND");
  const name = input.name === undefined ? current.name : sourceName(input.name);
  if (name.toLowerCase() !== current.name.trim().toLowerCase()) {
    const duplicate = await client.query(
      `SELECT 1 FROM tenant.crm_lead_sources WHERE organization_id = $1 AND lower(btrim(name)) = lower($2) AND id <> $3`,
      [context.organizationId, name, sourceId],
    );
    if (duplicate.rows[0]) throw new CrmError(409, "A lead source with this name already exists.", "CRM_LEAD_SOURCE_DUPLICATE");
  }
  const description = input.description === undefined ? current.description : String(input.description ?? "").trim().slice(0, 500) || null;
  const status = input.isActive === undefined ? current.status : input.isActive ? "active" : "inactive";
  const { rows } = await client.query(
    `UPDATE tenant.crm_lead_sources SET name = $3, description = $4, status = $5,
            is_default = CASE WHEN $5 = 'active' THEN is_default ELSE false END, updated_by = $6
      WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, sourceId, name, description, status, context.userId],
  );
  return toSource(rows[0]);
}

// A lead can only be given an active source of its own organization.
export async function assertActiveLeadSource(client, context, sourceId) {
  if (!sourceId) return;
  const { rows } = await client.query(
    `SELECT status FROM tenant.crm_lead_sources WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(sourceId, "Lead source")],
  );
  if (!rows[0]) throw new CrmError(400, "Choose a lead source from the list.", "CRM_LEAD_SOURCE_INVALID");
  if (rows[0].status !== "active") throw new CrmError(409, "This lead source is no longer active. Choose another.", "CRM_LEAD_SOURCE_INACTIVE");
}

// Finds an active source by name or code (import, integrations).
export async function findLeadSourceByName(client, context, value) {
  const name = String(value ?? "").trim();
  if (!name) return null;
  const { rows } = await client.query(
    `SELECT id FROM tenant.crm_lead_sources
      WHERE organization_id = $1 AND status = 'active' AND (lower(btrim(name)) = lower($2) OR code = lower($2))
      LIMIT 1`,
    [context.organizationId, name],
  );
  return rows[0]?.id ?? null;
}
