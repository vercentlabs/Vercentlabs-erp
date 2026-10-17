// Assets — Asset Identification, the reads: one asset's identity (code, serial, tag, previous code, QR and barcode, label status, history),
// the lookup behind every scan and search box (exact identifiers first; several matches give a list to choose from, never an arbitrary
// asset; only assets the person may see), the asset picker's search, labels for printing in bulk, the identification reports and export.
import { has, qx, text, uuid } from "../common.js";
import { QR_PREFIX } from "../asset-register/register-read.js";
import { LIFECYCLE, seesRegister } from "../asset-register/register-rules.js";
import { qrSvg } from "../asset-register/qr.js";
import { code128Svg } from "./code128.js";
import { CHANGE_KIND, IDENT, IDENTIFIER_TYPE, identError, mayPrint, normalizeIdentifier } from "./ident-rules.js";

const visible = (c) => (row) => seesRegister(c) || row.current_user_id === c.userId;
const seesHistory = (c) => has(c, IDENT.history) || has(c, IDENT.editSerial) || has(c, IDENT.editTag);
async function assetFor(client, c, assetId) {
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  return loadAssetRow(client, c, assetId);
}
export function labelOf(row) {
  const payload = `${QR_PREFIX}${row.qr_token}`;
  return { assetId: row.id, code: row.asset_number, name: row.name, tagCode: row.tag_code, serialNumber: row.serial_number, payload, qrSvg: qrSvg(payload, { scale: 4 }),
    barcodeSvg: code128Svg(row.asset_number, { module: 2, height: 44 }), labelPrintedAt: row.label_printed_at ?? null, labelPrintCount: row.label_print_count ?? 0 };
}

// ------------------------------------------------------------------ one asset's identity
export async function getAssetIdentification(client, c, assetId) {
  const row = await assetFor(client, c, assetId);
  const category = (await client.query(`SELECT name, serial_number_policy, asset_tag_policy FROM tenant.asset_categories WHERE id = $1`, [row.category_id])).rows[0] ?? {};
  const aliases = seesRegister(c) ? (await client.query(`SELECT identifier_type, value, active, ambiguous, effective_from, effective_to FROM tenant.asset_identifier_aliases WHERE organization_id = $1 AND asset_id = $2 ORDER BY effective_from DESC`,
    [c.organizationId, row.id])).rows.map((a) => ({ type: a.identifier_type, typeLabel: IDENTIFIER_TYPE[a.identifier_type], value: a.value, active: a.active, ambiguous: a.ambiguous, from: a.effective_from, to: a.effective_to })) : [];
  const exception = seesRegister(c) ? (await client.query(`SELECT reason, created_at FROM tenant.asset_identifier_exceptions WHERE organization_id = $1 AND asset_id = $2 ORDER BY created_at DESC LIMIT 1`, [c.organizationId, row.id])).rows[0] : null;
  const ended = row.archived_at || row.lifecycle_status === "DISPOSED";
  return {
    ...labelOf(row), assetId: row.id, version: row.row_version, manufacturer: row.manufacturer, model: row.model, legacyCode: row.legacy_asset_code ?? null, category: category.name ?? null,
    serialPolicy: category.serial_number_policy ?? "OPTIONAL", tagPolicy: category.asset_tag_policy ?? "OPTIONAL", serialMissing: category.serial_number_policy === "REQUIRED" && !row.serial_normalized,
    tagMissing: category.asset_tag_policy === "REQUIRED" && !row.tag_normalized, duplicateAccepted: exception ? { reason: exception.reason, at: exception.created_at } : null, aliases,
    note: "The asset code and QR token are permanent. Serial, tag and previous code change only through a recorded correction.",
    can: { editSerial: has(c, IDENT.editSerial) && !ended, editTag: has(c, IDENT.editTag) && !ended, legacy: has(c, IDENT.import) && !ended, print: mayPrint(c), history: seesHistory(c),
      resolveDuplicate: has(c, IDENT.resolveDuplicate) },
  };
}
export async function getAssetIdentifierHistory(client, c, assetId) {
  if (!seesHistory(c)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED", "You cannot view identifier history.");
  const row = await assetFor(client, c, assetId);
  const rows = (await client.query(`SELECT h.*, COALESCE(NULLIF(u.full_name, ''), u.email) AS actor FROM tenant.asset_identifier_history h LEFT JOIN public.users u ON u.id = h.changed_by
      WHERE h.organization_id = $1 AND h.asset_id = $2 ORDER BY h.changed_at DESC`, [c.organizationId, row.id])).rows;
  return { rows: rows.map((h) => ({ id: h.id, type: h.identifier_type, typeLabel: IDENTIFIER_TYPE[h.identifier_type], kind: h.change_kind, kindLabel: CHANGE_KIND[h.change_kind], from: h.old_value, to: h.new_value,
    reason: h.reason, by: h.actor, at: h.changed_at })) };
}

// ------------------------------------------------------------------ lookup
const CANDIDATE = `SELECT a.id, a.asset_number, a.name, a.serial_number, a.tag_code, a.legacy_asset_code, a.lifecycle_status, a.current_user_id, loc.name AS location_name
  FROM tenant.assets a LEFT JOIN tenant.asset_locations loc ON loc.id = a.location_id`;
const MATCHED_ON = { CODE: "Asset code", QR: "QR label", TAG: "Asset tag", SERIAL: "Serial number", LEGACY_CODE: "Previous asset code", PREVIOUS_TAG: "Previous tag", PREVIOUS_SERIAL: "Previous serial" };
const candidateOf = (row, on) => ({ assetId: row.id, code: row.asset_number, name: row.name, serialNumber: row.serial_number, tagCode: row.tag_code, legacyCode: row.legacy_asset_code,
  location: row.location_name ?? null, lifecycle: row.lifecycle_status, lifecycleLabel: LIFECYCLE[row.lifecycle_status], matchedOn: on, matchedOnLabel: MATCHED_ON[on], href: `/assets/register/${row.id}` });
// The value a scanner or a person typed → one asset, or a list to choose from. A QR token or an asset code is exact; a tag, serial or previous
// code may match several assets (a shared serial, an old code that is also another asset's tag), which are listed — never one picked.
export async function resolveAssetIdentifier(client, c, value) {
  if (!has(c, IDENT.view)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED", "You cannot look up assets.");
  const raw = text(value, 200);
  if (!raw) throw identError(400, "ASSET_IDENTIFIER_INVALID", "Scan or type an asset code, serial, tag or previous code.");
  const one = (row, on) => ({ assetId: row.id, href: `/assets/register/${row.id}`, method: on === "QR" ? "QR" : "SEARCH", matchedOn: on, matchedOnLabel: MATCHED_ON[on], matches: [candidateOf(row, on)] });
  if (raw.startsWith(QR_PREFIX)) {
    const row = (await client.query(`${CANDIDATE} WHERE a.organization_id = $1 AND a.qr_token = $2`, [c.organizationId, raw.slice(QR_PREFIX.length)])).rows.filter(visible(c))[0];
    if (!row) throw identError(404, "ASSET_IDENTIFIER_NOT_FOUND");
    return one(row, "QR");
  }
  const n = normalizeIdentifier(raw);
  if (!n) throw identError(400, "ASSET_IDENTIFIER_INVALID", `“${raw}” is not an identifier.`);
  const code = (await client.query(`${CANDIDATE} WHERE a.organization_id = $1 AND upper(a.asset_number) = $2`, [c.organizationId, n])).rows.filter(visible(c))[0];
  if (code) return one(code, "CODE");
  const find = async (active) => {
    const rows = (await client.query(`SELECT m.on_type, x.* FROM (
          SELECT id AS asset_id, 'TAG' AS on_type, 1 AS rank FROM tenant.assets WHERE organization_id = $1 AND tag_normalized = $2 AND $3
          UNION ALL SELECT id, 'SERIAL', 2 FROM tenant.assets WHERE organization_id = $1 AND serial_normalized = $2 AND $3
          UNION ALL SELECT id, 'LEGACY_CODE', 3 FROM tenant.assets WHERE organization_id = $1 AND legacy_normalized = $2 AND $3
          UNION ALL SELECT asset_id, identifier_type, 4 FROM tenant.asset_identifier_aliases WHERE organization_id = $1 AND normalized = $2 AND active = $3 AND identifier_type <> 'LEGACY_CODE'
        ) m JOIN (${CANDIDATE}) x ON x.id = m.asset_id ORDER BY m.rank, x.asset_number LIMIT 50`, [c.organizationId, n, active])).rows.filter(visible(c));
    const seen = new Set();
    return rows.filter((r) => (seen.has(r.id) ? false : seen.add(r.id))).map((r) => candidateOf(r, r.on_type));
  };
  let matches = await find(true);
  if (!matches.length) matches = (await find(false)).filter((m) => m.matchedOn.startsWith("PREVIOUS_"));
  if (!matches.length) throw identError(404, "ASSET_IDENTIFIER_NOT_FOUND");
  if (matches.length === 1) return { assetId: matches[0].assetId, href: matches[0].href, method: "SEARCH", matchedOn: matches[0].matchedOn, matchedOnLabel: matches[0].matchedOnLabel, matches };
  return { ambiguous: true, method: "SEARCH", message: "Several assets match this identifier. Please select one.", matches };
}
// The asset picker every workflow uses: partial code, name, serial, tag or previous code; exact matches first; only visible assets.
export async function searchAssetsForPicker(client, c, filters = {}) {
  if (!has(c, IDENT.view)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED", "You cannot look up assets.");
  const q = text(filters.q, 100);
  if (q.length < 2) return { rows: [] };
  const n = normalizeIdentifier(q) ?? q.toUpperCase();
  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const rows = (await qx(client, `${CANDIDATE} WHERE a.organization_id = $1 AND a.archived_at IS NULL ${filters.includeEnded ? "" : "AND a.lifecycle_status NOT IN ('DISPOSED')"}
      AND (a.asset_number ILIKE $2 OR a.name ILIKE $2 OR a.serial_number ILIKE $2 OR a.tag_code ILIKE $2 OR a.legacy_asset_code ILIKE $2 OR a.model ILIKE $2)
      ORDER BY (upper(a.asset_number) = $3 OR a.tag_normalized = $3 OR a.serial_normalized = $3 OR a.legacy_normalized = $3) DESC, a.asset_number LIMIT 40`, [c.organizationId, like, n])).rows;
  return { rows: rows.filter(visible(c)).slice(0, 20).map((r) => candidateOf(r, upperEq(r, n))) };
}
const upperEq = (r, n) => (String(r.asset_number).toUpperCase() === n ? "CODE" : normalizeIdentifier(r.tag_code) === n ? "TAG" : normalizeIdentifier(r.serial_number) === n ? "SERIAL" : normalizeIdentifier(r.legacy_asset_code) === n ? "LEGACY_CODE" : "CODE");

// ------------------------------------------------------------------ labels in bulk
// filters: { assetIds? } or { categoryId?, locationId?, batchId?, unlabelled? } — at most 200 labels a time.
export async function getAssetLabels(client, c, filters = {}) {
  if (!mayPrint(c)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED", "You cannot print asset labels.");
  const values = [c.organizationId];
  const bind = (v) => { values.push(v); return `$${values.length}`; };
  const where = ["a.organization_id = $1", "a.archived_at IS NULL", "a.lifecycle_status NOT IN ('DRAFT', 'DISPOSED')"];
  const ids = Array.isArray(filters.assetIds) ? filters.assetIds : typeof filters.assetIds === "string" && filters.assetIds ? filters.assetIds.split(",") : [];
  if (ids.length) where.push(`a.id = ANY(${bind(ids.slice(0, 200).map((id) => uuid(id, "Asset")))}::uuid[])`);
  if (filters.categoryId) where.push(`a.category_id = ${bind(uuid(filters.categoryId, "Category"))}`);
  if (filters.locationId) where.push(`a.location_id = ${bind(uuid(filters.locationId, "Location"))}`);
  if (filters.batchId) where.push(`a.registration_batch_id = ${bind(uuid(filters.batchId, "Batch"))}`);
  if (filters.unlabelled === true || filters.unlabelled === "true") where.push("a.label_printed_at IS NULL");
  const rows = (await qx(client, `SELECT a.* FROM tenant.assets a WHERE ${where.join(" AND ")} ORDER BY a.asset_number LIMIT 201`, values)).rows.filter(visible(c));
  if (rows.length > 1 && !has(c, IDENT.bulkPrint)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED", "Printing many labels at once needs the bulk-print permission.");
  return { rows: rows.slice(0, 200).map(labelOf), more: rows.length > 200 };
}

// ------------------------------------------------------------------ reports and export
export const IDENT_REPORTS = Object.freeze(["identification", "missing-serials", "duplicate-serials", "missing-labels", "legacy-mapping", "identifier-corrections", "ended-identification",
  "identification-exceptions"]);
export async function getIdentificationReport(client, c, kind) {
  if (!IDENT_REPORTS.includes(kind)) throw identError(400, "ASSET_IDENTIFIER_INVALID", "Unknown report.");
  if (!seesRegister(c)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED", "Identification reports need register access.");
  const q = async (sql) => (await qx(client, sql, [c.organizationId])).rows;
  const base = `FROM tenant.assets a LEFT JOIN tenant.asset_categories cat ON cat.id = a.category_id LEFT JOIN tenant.asset_locations loc ON loc.id = a.location_id WHERE a.organization_id = $1`;
  switch (kind) {
    case "identification": return (await q(`SELECT a.id, a.asset_number, a.name, a.serial_number, a.tag_code, a.legacy_asset_code, cat.name AS category, loc.name AS location, a.lifecycle_status, a.label_printed_at
        ${base} AND a.archived_at IS NULL ORDER BY a.asset_number LIMIT 2000`)).map((r) => ({ code: r.asset_number, name: r.name, serial: r.serial_number, tag: r.tag_code, previousCode: r.legacy_asset_code,
      category: r.category, location: r.location, status: LIFECYCLE[r.lifecycle_status], labelled: r.label_printed_at ? "Yes" : "No", href: `/assets/register/${r.id}` }));
    case "missing-serials": return (await q(`SELECT a.id, a.asset_number, a.name, cat.name AS category, a.serial_number, a.lifecycle_status ${base} AND a.archived_at IS NULL AND a.lifecycle_status <> 'DISPOSED'
        AND cat.serial_number_policy = 'REQUIRED' AND a.serial_normalized IS NULL ORDER BY a.asset_number`)).map((r) => ({ asset: `${r.asset_number} · ${r.name}`, category: r.category,
      recorded: r.serial_number ? `“${r.serial_number}” (not a serial)` : "Blank", status: LIFECYCLE[r.lifecycle_status], href: `/assets/register/${r.id}` }));
    case "duplicate-serials": return (await q(`SELECT a.serial_normalized, string_agg(a.asset_number || ' · ' || COALESCE(a.manufacturer, 'no manufacturer'), '; ' ORDER BY a.asset_number) AS assets, count(*)::int AS n,
        bool_or(EXISTS (SELECT 1 FROM tenant.asset_identifier_exceptions e WHERE e.asset_id = a.id)) AS accepted, min(a.id::text) AS first_id
        ${base} AND a.serial_normalized IS NOT NULL GROUP BY a.serial_normalized HAVING count(*) > 1 ORDER BY 3 DESC, 1`)).map((r) => ({ serial: r.serial_normalized, assets: r.assets, count: r.n,
      status: r.accepted ? "Accepted as a genuine shared serial" : "Review — possible duplicate" }));
    case "missing-labels": return (await q(`SELECT a.id, a.asset_number, a.name, a.tag_code, cat.asset_tag_policy, a.label_printed_at, loc.name AS location ${base} AND a.archived_at IS NULL
        AND a.lifecycle_status NOT IN ('DRAFT', 'DISPOSED') AND (a.label_printed_at IS NULL OR (cat.asset_tag_policy = 'REQUIRED' AND a.tag_normalized IS NULL)) ORDER BY a.asset_number`)).map((r) => ({
      asset: `${r.asset_number} · ${r.name}`, location: r.location, missing: [!r.label_printed_at && "label never printed", r.asset_tag_policy === "REQUIRED" && !r.tag_code && "required tag"].filter(Boolean).join(", "), href: `/assets/register/${r.id}` }));
    case "legacy-mapping": return (await q(`SELECT a.id, x.value, x.ambiguous, x.active, a.asset_number, a.name FROM tenant.asset_identifier_aliases x JOIN tenant.assets a ON a.id = x.asset_id
        WHERE x.organization_id = $1 AND x.identifier_type = 'LEGACY_CODE' ORDER BY x.value`)).map((r) => ({ previousCode: r.value, asset: `${r.asset_number} · ${r.name}`, state: !r.active ? "Replaced" : r.ambiguous ? "Also matches another asset" : "Current",
      href: `/assets/register/${r.id}` }));
    case "identifier-corrections": return (await q(`SELECT h.*, a.asset_number, a.name, COALESCE(NULLIF(u.full_name, ''), u.email) AS actor FROM tenant.asset_identifier_history h JOIN tenant.assets a ON a.id = h.asset_id
        LEFT JOIN public.users u ON u.id = h.changed_by WHERE h.organization_id = $1 ORDER BY h.changed_at DESC LIMIT 1000`)).map((r) => ({ asset: `${r.asset_number} · ${r.name}`, identifier: IDENTIFIER_TYPE[r.identifier_type],
      change: CHANGE_KIND[r.change_kind], from: r.old_value ?? "—", to: r.new_value ?? "—", reason: r.reason ?? "—", by: r.actor, at: r.changed_at, href: `/assets/register/${r.asset_id}` }));
    case "ended-identification": return (await q(`SELECT a.id, a.asset_number, a.name, a.serial_number, a.tag_code, a.legacy_asset_code, a.lifecycle_status, a.disposed_at ${base} AND a.lifecycle_status IN ('RETIRED', 'DISPOSED', 'LOST')
        ORDER BY a.asset_number`)).map((r) => ({ code: r.asset_number, name: r.name, serial: r.serial_number, tag: r.tag_code, previousCode: r.legacy_asset_code, status: LIFECYCLE[r.lifecycle_status], href: `/assets/register/${r.id}` }));
    case "identification-exceptions": return getIdentificationExceptions(client, c);
    default: return [];
  }
}
// What needs attention: required identifiers missing, placeholders recorded as serials, possible duplicate serials, tags repeated in
// older data, previous codes that also match another asset.
export async function getIdentificationExceptions(client, c) {
  if (!seesRegister(c)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED", "Identification exceptions need register access.");
  const q = async (sql) => (await qx(client, sql, [c.organizationId])).rows;
  const out = [];
  for (const r of await q(`SELECT a.id, a.asset_number, a.serial_number FROM tenant.assets a WHERE a.organization_id = $1 AND a.serial_number IS NOT NULL AND a.serial_normalized IS NULL AND a.archived_at IS NULL`)) {
    out.push({ kind: "PLACEHOLDER_SERIAL", issue: `“${r.serial_number}” is recorded as the serial number`, asset: r.asset_number, href: `/assets/register/${r.id}` });
  }
  for (const r of await q(`SELECT a.serial_normalized, string_agg(a.asset_number, ', ' ORDER BY a.asset_number) AS codes, min(a.id::text) AS id FROM tenant.assets a WHERE a.organization_id = $1 AND a.serial_normalized IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM tenant.asset_identifier_exceptions e WHERE e.asset_id = a.id) GROUP BY a.serial_normalized HAVING count(*) > 1`)) {
    out.push({ kind: "DUPLICATE_SERIAL", issue: `Serial ${r.serial_normalized} is on ${r.codes}`, asset: r.codes, href: `/assets/register/${r.id}` });
  }
  for (const r of await q(`SELECT a.tag_normalized, string_agg(a.asset_number, ', ' ORDER BY a.asset_number) AS codes, min(a.id::text) AS id FROM tenant.assets a WHERE a.organization_id = $1 AND a.tag_normalized IS NOT NULL
      GROUP BY a.tag_normalized HAVING count(*) > 1`)) {
    out.push({ kind: "DUPLICATE_TAG", issue: `Tag ${r.tag_normalized} is on ${r.codes}`, asset: r.codes, href: `/assets/register/${r.id}` });
  }
  for (const r of await q(`SELECT a.id, a.asset_number, x.value FROM tenant.asset_identifier_aliases x JOIN tenant.assets a ON a.id = x.asset_id WHERE x.organization_id = $1 AND x.active AND x.ambiguous`)) {
    out.push({ kind: "AMBIGUOUS_PREVIOUS_CODE", issue: `Previous code ${r.value} also matches another asset`, asset: r.asset_number, href: `/assets/register/${r.id}` });
  }
  return out;
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function exportAssetIdentifiers(client, c) {
  if (!has(c, IDENT.export)) throw identError(403, "ASSET_IDENTIFIER_EDIT_DENIED", "You cannot export asset identifiers.");
  const rows = await getIdentificationReport(client, c, "identification");
  const header = ["Asset code", "Name", "Serial number", "Asset tag", "Previous code", "Category", "Location", "Status", "Label printed"];
  return { fileName: "asset-identifiers.csv", csv: [header, ...rows.map((r) => [r.code, r.name, r.serial, r.tag, r.previousCode, r.category, r.location, r.status, r.labelled])].map((l) => l.map(csvCell).join(",")).join("\r\n") };
}
