// Assets — Asset Identification, the commands. After registration an identifier changes only through a controlled correction: a serial is
// corrected, a tag replaced or removed, a previous code recorded — each with a reason, by someone allowed to, on the current version of
// the asset. The asset's UUID, its code and everything recorded against it (custody, depreciation, maintenance) are untouched; the old
// value stays in the identifier history and as a retired alias. Printing a label is recorded so the register knows which assets are labelled.
import { has, recordAssetEvent, text, uuid } from "../common.js";
import { checkIdentifiers, cleanIdentifier, recordDuplicateException } from "./ident-checks.js";
import { IDENT, identError, mayPrint, normalizeIdentifier } from "./ident-rules.js";

const versionCheck = (row, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(row.row_version)) throw identError(409, "ASSET_VERSION_CONFLICT", undefined, { current: row.row_version });
};
async function loadForChange(client, c, assetId, input) {
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  const row = await loadAssetRow(client, c, assetId, { lock: true });
  versionCheck(row, input.expectedVersion);
  if (row.archived_at || row.lifecycle_status === "DISPOSED") throw identError(409, "ASSET_STATE_INVALID", "A disposed or archived asset keeps its identifiers as they were.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw identError(400, "ASSET_IDENTIFIER_INVALID", "Give the reason for the change.", { field: "reason" });
  const category = (await client.query(`SELECT serial_number_policy, asset_tag_policy FROM tenant.asset_categories WHERE id = $1`, [row.category_id])).rows[0] ?? {};
  return { row, reason, category };
}
async function history(client, c, assetId, type, kind, from, to, reason) {
  await client.query(`INSERT INTO tenant.asset_identifier_history (organization_id, asset_id, identifier_type, change_kind, old_value, new_value, reason, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [c.organizationId, assetId, type, kind, from ?? null, to ?? null, reason ?? null, c.userId]);
}
// The value an asset used to carry: kept as a retired alias, so the history can still find it but it never identifies the asset by itself.
async function retireAs(client, c, assetId, type, value) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return;
  await client.query(`INSERT INTO tenant.asset_identifier_aliases (organization_id, asset_id, identifier_type, value, normalized, active, effective_to, created_by) VALUES ($1,$2,$3,$4,$5,false,clock_timestamp(),$6)`,
    [c.organizationId, assetId, type, value, normalized, c.userId]);
}

// input: { serialNumber (blank removes it), reason, expectedVersion?, duplicateException?: { reason } }
export async function correctAssetSerial(client, c, assetId, input = {}) {
  if (!has(c, IDENT.editSerial)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED");
  const { row, reason, category } = await loadForChange(client, c, assetId, input);
  const next = cleanIdentifier(input.serialNumber, "serial number", 120);
  if ((next ?? null) === (row.serial_number ?? null)) return { assetId: row.id, changed: false, version: row.row_version, warnings: [] };
  if (!next && category.serial_number_policy === "REQUIRED" && row.lifecycle_status !== "DRAFT") throw identError(400, "ASSET_SERIAL_REQUIRED", "This category requires a serial number; correct it instead of removing it.");
  const { warnings, exception } = await checkIdentifiers(client, c, { serialNumber: next, manufacturer: row.manufacturer, duplicateException: input.duplicateException }, row.id);
  const updated = (await client.query(`UPDATE tenant.assets SET serial_number = $3 WHERE organization_id = $1 AND id = $2 RETURNING *`, [c.organizationId, row.id, next])).rows[0];
  await history(client, c, row.id, "SERIAL", next ? "CORRECTION" : "REMOVAL", row.serial_number, next, reason);
  await retireAs(client, c, row.id, "PREVIOUS_SERIAL", row.serial_number);
  await recordAssetEvent(client, c, row.id, "asset.serial_corrected", { from: row.serial_number ?? null, to: next, reason });
  await recordDuplicateException(client, c, updated, exception, next);
  return { assetId: row.id, changed: true, version: updated.row_version, warnings };
}

// input: { tagCode (blank removes it), reason, expectedVersion? } — the old tag is released, so it never identifies two active assets.
export async function replaceAssetTag(client, c, assetId, input = {}) {
  if (!has(c, IDENT.editTag)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED");
  const { row, reason, category } = await loadForChange(client, c, assetId, input);
  const next = cleanIdentifier(input.tagCode, "asset tag", 60);
  if ((next ?? null) === (row.tag_code ?? null)) return { assetId: row.id, changed: false, version: row.row_version };
  if (!next && category.asset_tag_policy === "REQUIRED" && row.lifecycle_status !== "DRAFT") throw identError(400, "ASSET_IDENTIFIER_INVALID", "This category requires an asset tag; replace it instead of removing it.");
  await checkIdentifiers(client, c, { tagCode: next }, row.id);
  const updated = (await client.query(`UPDATE tenant.assets SET tag_code = $3 WHERE organization_id = $1 AND id = $2 RETURNING *`, [c.organizationId, row.id, next])).rows[0];
  await history(client, c, row.id, "TAG", next ? "REPLACEMENT" : "REMOVAL", row.tag_code, next, reason);
  await retireAs(client, c, row.id, "PREVIOUS_TAG", row.tag_code);
  await recordAssetEvent(client, c, row.id, "asset.tag_replaced", { from: row.tag_code ?? null, to: next, reason });
  return { assetId: row.id, changed: true, version: updated.row_version };
}

// A historical code from an earlier register: unique among previous codes; one that equals another asset's code or tag is kept but
// flagged ambiguous, so a lookup lists both instead of opening either. Used by the import and, with a reason, on one asset.
export async function attachLegacyCode(client, c, asset, value, { kind = "IMPORT", reason = null } = {}) {
  const legacy = cleanIdentifier(value, "previous asset code", 80);
  const normalized = normalizeIdentifier(legacy);
  if (!normalized) return null;
  const taken = (await client.query(`SELECT asset_number FROM tenant.assets WHERE organization_id = $1 AND legacy_normalized = $2 AND id <> $3 LIMIT 1`, [c.organizationId, normalized, asset.id])).rows[0];
  if (taken) throw identError(409, "ASSET_IDENTIFIER_AMBIGUOUS", `${taken.asset_number} already has the previous code ${legacy}.`, { assetNumber: taken.asset_number });
  const clash = (await client.query(`SELECT asset_number FROM tenant.assets WHERE organization_id = $1 AND id <> $3 AND (upper(asset_number) = $2 OR tag_normalized = $2 OR serial_normalized = $2) LIMIT 1`,
    [c.organizationId, normalized, asset.id])).rows[0];
  await client.query(`UPDATE tenant.asset_identifier_aliases SET active = false, effective_to = clock_timestamp() WHERE organization_id = $1 AND asset_id = $2 AND identifier_type = 'LEGACY_CODE' AND active`, [c.organizationId, asset.id]);
  await client.query(`UPDATE tenant.assets SET legacy_asset_code = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, asset.id, legacy]);
  await client.query(`INSERT INTO tenant.asset_identifier_aliases (organization_id, asset_id, identifier_type, value, normalized, ambiguous, created_by) VALUES ($1,$2,'LEGACY_CODE',$3,$4,$5,$6)`,
    [c.organizationId, asset.id, legacy, normalized, Boolean(clash), c.userId]);
  await history(client, c, asset.id, "LEGACY_CODE", kind, asset.legacy_asset_code ?? null, legacy, reason ?? (clash ? `Also matches ${clash.asset_number}` : null));
  return { legacyCode: legacy, ambiguousWith: clash?.asset_number ?? null };
}
// input: { legacyCode, reason, expectedVersion? }
export async function setAssetLegacyCode(client, c, assetId, input = {}) {
  if (!has(c, IDENT.import)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED");
  const { row, reason } = await loadForChange(client, c, assetId, input);
  if (!normalizeIdentifier(input.legacyCode)) throw identError(400, "ASSET_IDENTIFIER_INVALID", "Enter the previous asset code.", { field: "legacyCode" });
  if (normalizeIdentifier(input.legacyCode) === row.legacy_normalized) return { assetId: row.id, changed: false };
  const done = await attachLegacyCode(client, c, row, input.legacyCode, { kind: row.legacy_asset_code ? "CORRECTION" : "IMPORT", reason });
  await recordAssetEvent(client, c, row.id, "asset.legacy_code_set", { from: row.legacy_asset_code ?? null, to: done.legacyCode, reason });
  return { assetId: row.id, changed: true, ...done };
}

// input: { assetIds } — the labels were printed (one asset, or many with the bulk permission).
export async function markAssetLabelsPrinted(client, c, input = {}) {
  const ids = [...new Set((Array.isArray(input.assetIds) ? input.assetIds : []).map((id) => uuid(id, "Asset")))];
  if (!ids.length || ids.length > 500) throw identError(400, "ASSET_IDENTIFIER_INVALID", "Choose between 1 and 500 assets.");
  if (!mayPrint(c) || (ids.length > 1 && !has(c, IDENT.bulkPrint))) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED", "You cannot print these labels.");
  const rows = (await client.query(`UPDATE tenant.assets SET label_printed_at = clock_timestamp(), label_print_count = label_print_count + 1 WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL RETURNING id, label_print_count`,
    [c.organizationId, ids])).rows;
  for (const r of rows) await recordAssetEvent(client, c, r.id, r.label_print_count > 1 ? "asset.label_reprinted" : "asset.label_printed", { count: r.label_print_count });
  return { printed: rows.length };
}
