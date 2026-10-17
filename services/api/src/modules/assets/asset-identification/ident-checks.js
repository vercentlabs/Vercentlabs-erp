// Assets — Asset Identification, the checks registration and corrections share. A tag identifies one asset within the Company. A serial is
// compared in its normalized form: the same serial on an asset of the same (or an unrecorded) manufacturer is a clear duplicate and is
// refused, unless someone allowed to resolve duplicates accepts it with a reason; the same serial from a different manufacturer is a
// warning only (manufacturers reuse values). Placeholders such as N/A are refused — leave the serial blank instead.
import { has, text } from "../common.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { IDENT, identError, isPlaceholder, normalizeIdentifier } from "./ident-rules.js";

// The text kept for display, refused when it is a placeholder.
export function cleanIdentifier(value, label, max) {
  const raw = text(value, max);
  if (!raw) return null;
  if (isPlaceholder(raw)) throw identError(400, "ASSET_IDENTIFIER_INVALID", `“${raw}” is not a ${label}. Leave it blank if the asset has none.`, { field: label });
  return raw;
}

// input: { serialNumber?, tagCode?, manufacturer?, duplicateException?: { reason } } → { warnings, exception } — throws on a clear duplicate.
export async function checkIdentifiers(client, c, input, exceptId = null) {
  const warnings = [];
  let exception = null;
  const tag = normalizeIdentifier(input.tagCode);
  if (tag) {
    const dup = (await client.query(`SELECT asset_number FROM tenant.assets WHERE organization_id = $1 AND tag_normalized = $2 AND id IS DISTINCT FROM $3 LIMIT 1`, [c.organizationId, tag, exceptId])).rows[0];
    if (dup) throw identError(409, "ASSET_TAG_DUPLICATE", `${dup.asset_number} already carries tag ${input.tagCode}.`, { assetNumber: dup.asset_number });
  }
  const serial = normalizeIdentifier(input.serialNumber);
  if (serial) {
    const matches = (await client.query(`SELECT id, asset_number, name, manufacturer, model FROM tenant.assets WHERE organization_id = $1 AND serial_normalized = $2 AND id IS DISTINCT FROM $3 ORDER BY asset_number LIMIT 20`,
      [c.organizationId, serial, exceptId])).rows;
    if (matches.length) {
      const maker = normalizeIdentifier(input.manufacturer);
      const clear = matches.filter((m) => !maker || !normalizeIdentifier(m.manufacturer) || normalizeIdentifier(m.manufacturer) === maker);
      const list = matches.map((m) => ({ assetId: m.id, code: m.asset_number, name: m.name, manufacturer: m.manufacturer, model: m.model }));
      if (clear.length) {
        const reason = text(input.duplicateException?.reason, 1000);
        if (!input.duplicateException) {
          throw identError(409, "ASSET_SERIAL_DUPLICATE", `${clear[0].asset_number} already has serial number ${input.serialNumber}.`,
            { assetNumber: clear[0].asset_number, matches: list, canAccept: has(c, IDENT.resolveDuplicate) });
        }
        if (!has(c, IDENT.resolveDuplicate)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED", "Only someone allowed to resolve duplicates can accept a repeated serial number.");
        if (reason.length < 3) throw identError(400, "ASSET_IDENTIFIER_INVALID", "Give the reason this serial number is genuinely shared.", { field: "duplicateException.reason" });
        exception = { normalized: serial, matchedAssetIds: matches.map((m) => m.id), reason, codes: matches.map((m) => m.asset_number) };
      } else {
        warnings.push({ code: "ASSET_SERIAL_POSSIBLE_MATCH", message: `Serial ${input.serialNumber} is also recorded on ${list.map((m) => `${m.code} (${m.manufacturer})`).join(", ")} from another manufacturer.`, matches: list });
      }
    }
  }
  return { warnings, exception };
}

// The authorized exception, recorded once the asset exists, and announced to the others who resolve duplicates.
export async function recordDuplicateException(client, c, asset, exception, serialNumber) {
  if (!exception) return;
  await client.query(`INSERT INTO tenant.asset_identifier_exceptions (organization_id, asset_id, identifier_type, normalized_value, matched_asset_ids, reason, approved_by) VALUES ($1,$2,'SERIAL',$3,$4,$5,$6)`,
    [c.organizationId, asset.id, exception.normalized, exception.matchedAssetIds, exception.reason, c.userId]);
  await client.query(`INSERT INTO tenant.asset_identifier_history (organization_id, asset_id, identifier_type, change_kind, old_value, new_value, reason, changed_by) VALUES ($1,$2,'SERIAL','DUPLICATE_EXCEPTION',NULL,$3,$4,$5)`,
    [c.organizationId, asset.id, serialNumber, `Also on ${exception.codes.join(", ")}: ${exception.reason}`, c.userId]);
  const others = (await client.query(`SELECT DISTINCT assignment.user_id FROM user_role_assignments assignment JOIN role_permissions grant_row ON grant_row.role_id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.status = 'active' AND grant_row.permission_key = $2`, [c.organizationId, IDENT.resolveDuplicate]).catch(() => ({ rows: [] }))).rows;
  for (const { user_id: userId } of others) {
    if (userId === c.userId) continue;
    await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_register", title: `${asset.asset_number}: duplicate serial accepted`,
      message: `${serialNumber} is also on ${exception.codes.join(", ")}. ${exception.reason}`, href: `/assets/register/${asset.id}`, entityType: "assets.asset", entityId: asset.id });
  }
}
