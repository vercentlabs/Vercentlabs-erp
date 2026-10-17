// Quality — Inspection Specifications: loading rows (dates as plain text) and the append-only event history.
import { qx } from "../common.js";
import { specError, uuid } from "./qs-rules.js";

export async function loadSpec(client, c, specId, { lock = false } = {}) {
  const row = (await qx(client, `SELECT * FROM tenant.quality_inspection_specifications WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(specId, "Specification")])).rows[0];
  if (!row) throw specError(404, "QUALITY_SPEC_NOT_FOUND");
  return row;
}
export async function loadVersion(client, c, specId, versionId, { lock = false } = {}) {
  const row = (await qx(client, `SELECT * FROM tenant.quality_inspection_spec_versions WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(versionId, "Version")])).rows[0];
  if (!row || (specId && row.specification_id !== specId)) throw specError(404, "QUALITY_SPEC_NOT_FOUND", "That specification version was not found.");
  return row;
}
export async function loadChecks(client, c, versionId) {
  return (await qx(client, `SELECT * FROM tenant.quality_inspection_characteristics WHERE organization_id = $1 AND version_id = $2 ORDER BY sequence`, [c.organizationId, versionId])).rows;
}
export async function versionsOf(client, c, specId) {
  return (await qx(client, `SELECT * FROM tenant.quality_inspection_spec_versions WHERE organization_id = $1 AND specification_id = $2 ORDER BY version_number`, [c.organizationId, specId])).rows;
}
export async function unitsOf(client, c) {
  const { rows } = await client.query(`SELECT id, code, name, COALESCE(status, 'active') AS status FROM tenant.units_of_measure WHERE organization_id = $1`, [c.organizationId]);
  return new Map(rows.filter((u) => u.status === "active").map((u) => [u.id, u]));
}
export async function settingsOf(client, c) {
  const row = (await client.query(`SELECT spec_prohibit_self_approval, spec_approval_note_required FROM tenant.quality_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  return { prohibitSelfApproval: row ? row.spec_prohibit_self_approval : true, approvalNoteRequired: row ? row.spec_approval_note_required : false };
}
export async function recordSpecEvent(client, c, { specId, versionId = null, action, from = null, to = null, note = null, details = {} }) {
  await client.query(`INSERT INTO tenant.quality_spec_events (organization_id, specification_id, version_id, action, from_status, to_status, note, details, actor_user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`, [c.organizationId, specId, versionId, action, from, to, note, JSON.stringify(details), c.userId ?? null]);
}
export const today = async (client) => (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
// A reference of the Company (RLS hides every other Company's rows, so another Company's id is simply not found).
export async function companyRow(client, c, table, id, columns = "id") {
  if (!id) return null;
  return (await client.query(`SELECT ${columns} FROM tenant.${table} WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0] ?? null;
}
