// Assets — Opening / Existing Assets, the commands. A batch is started from a file or by hand with an explicit cutover date; its rows are
// validated and corrected; matches with assets already in the register are resolved (link, create or skip) before anything is created;
// valid rows are registered — each on its own, so one bad row never blocks the rest and a retry never registers a row twice — with an
// opening baseline for lifecycle, location and custody. Finance then reconciles the opening positions with its opening balances (already
// posted: linked; not yet posted: a draft for Finance's own opening-balance workflow), approves them separately, and closes the batch,
// which locks them. Nothing here posts a journal or repeats historical depreciation.
import { createHash } from "node:crypto";
import { has, loadSettings, recordAssetEvent, text, uuid } from "../common.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { normalizeIdentifier } from "../asset-identification/ident-rules.js";
import { OPENING, dayOfDb, openingError, requireOpening } from "./opening-rules.js";
import { normalizeRecord, validateRow } from "./opening-validate.js";

async function loadBatch(client, c, batchId, { lock = false } = {}) {
  let id;
  try { id = uuid(batchId, "Migration batch"); } catch { throw openingError(404, "ASSET_OPENING_NOT_FOUND"); }
  const b = (await client.query(`SELECT * FROM tenant.asset_opening_batches WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
  if (!b) throw openingError(404, "ASSET_OPENING_NOT_FOUND");
  return b;
}
export { loadBatch };
const versionCheck = (b, expected) => { if (expected !== undefined && expected !== null && Number(expected) !== Number(b.row_version)) throw openingError(409, "ASSET_OPENING_VERSION_CONFLICT"); };
async function logEvent(client, c, batchId, action, details = {}, { assetId = null, reason = null } = {}) {
  await client.query(`INSERT INTO tenant.asset_opening_events (organization_id, batch_id, asset_id, action, details, reason, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.organizationId, batchId, assetId, action, JSON.stringify(details), reason, c.userId]);
}
async function usersWith(client, c, permission) {
  return (await client.query(`SELECT DISTINCT assignment.user_id FROM user_role_assignments assignment JOIN role_permissions grant_row ON grant_row.role_id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.status = 'active' AND grant_row.permission_key = $2`, [c.organizationId, permission]).catch(() => ({ rows: [] }))).rows.map((r) => r.user_id);
}
const dayOf = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? String(value) : null);
async function cutoverFor(client, c, value) {
  const day = dayOf(value);
  if (!day) throw openingError(400, "ASSET_OPENING_INVALID_DATE", "Choose the cutover date: the day Vercentlabs takes over from the earlier register.", { field: "cutoverDate" });
  const settings = await loadSettings(client, c);
  if (settings.opening_cutover_date && dayOfDb(settings.opening_cutover_date) !== day) {
    throw openingError(409, "ASSET_OPENING_PERIOD_LOCKED", `The Company's cutover is ${dayOfDb(settings.opening_cutover_date)}; a migration uses that date.`);
  }
  return day;
}

// ------------------------------------------------------------------ references for validation
async function references(client, c, cutoverDate) {
  const q = async (sql) => (await client.query(sql, [c.organizationId])).rows;
  const byKey = (rows, key) => { const m = new Map(); for (const r of rows) { const k = r[key]; if (!k) continue; m.set(k, [...(m.get(k) ?? []), r]); } return m; };
  const assets = await q(`SELECT id, asset_number, name, manufacturer, legacy_normalized, serial_normalized, tag_normalized FROM tenant.assets WHERE organization_id = $1 AND archived_at IS NULL`);
  const aliases = await q(`SELECT x.normalized, a.id, a.asset_number, a.name, a.manufacturer FROM tenant.asset_identifier_aliases x JOIN tenant.assets a ON a.id = x.asset_id WHERE x.organization_id = $1 AND x.active AND x.identifier_type = 'LEGACY_CODE'`);
  const legacy = byKey(assets, "legacy_normalized");
  for (const a of aliases) if (!(legacy.get(a.normalized) ?? []).some((x) => x.id === a.id)) legacy.set(a.normalized, [...(legacy.get(a.normalized) ?? []), a]);
  return {
    cutoverDate,
    baseCurrency: (await client.query(`SELECT upper(base_currency) AS c FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.c ?? "INR",
    categories: await q(`SELECT id, code, name, serial_number_policy, asset_tag_policy, location_required, capitalization_guidance, depreciation_method FROM tenant.asset_categories WHERE organization_id = $1 AND active AND deleted_at IS NULL`),
    locations: await q(`SELECT id, code, name, is_asset_store, manager_user_id FROM tenant.asset_locations WHERE organization_id = $1 AND active`),
    departments: await q(`SELECT id, code, name FROM public.departments WHERE organization_id = $1`),
    members: await q(`SELECT u.id, lower(u.email) AS email, CASE WHEN m.status = 'active' AND u.status = 'active' THEN 'active' ELSE 'inactive' END AS status FROM public.users u JOIN public.organization_memberships m ON m.user_id = u.id WHERE m.organization_id = $1`),
    parties: await q(`SELECT id, code, display_name AS name FROM tenant.business_parties WHERE organization_id = $1`),
    register: { legacy, serial: byKey(assets, "serial_normalized"), tag: byKey(assets, "tag_normalized") },
    file: { legacy: new Map(), serial: new Map(), tag: new Map() },
  };
}
// One row's state from its validation and resolution.
function stateOf(result, row) {
  if (result.errors.length) return "INVALID";
  if (row.resolution === "SKIP") return "SKIPPED";
  const strong = result.matches.filter((m) => m.strong);
  if (strong.length && !row.resolution) return "DUPLICATE";
  if (row.resolution === "LINK" && !row.link_asset_id) return "DUPLICATE";
  if (row.resolution === "CREATE" && strong.some((m) => /previous code|asset tag/.test(m.reason))) return "DUPLICATE";
  return "VALID";
}
async function revalidate(client, c, batch) {
  const refs = await references(client, c, dayOfDb(batch.cutover_date));
  const rows = (await client.query(`SELECT * FROM tenant.asset_opening_rows WHERE batch_id = $1 ORDER BY row_number`, [batch.id])).rows;
  for (const row of rows) {
    if (["REGISTERED", "LINKED"].includes(row.status)) {
      // Registered rows still claim their identifiers within the file.
      const d = normalizeRecord({ ...row.raw, ...(row.data?.corrections ?? {}) });
      for (const [kind, col] of [["legacy", "existing_asset_code"], ["serial", "serial_number"], ["tag", "asset_tag"]]) { const v = normalizeIdentifier(d[col]); if (v) refs.file[kind].set(v, row.row_number); }
      continue;
    }
    const corrections = row.data?.corrections ?? {};
    const result = validateRow({ ...row.raw, ...corrections }, row.row_number, refs);
    const status = stateOf(result, row);
    if (status === "DUPLICATE" && row.resolution === "CREATE") result.errors.push({ field: "resolution", code: "ASSET_OPENING_DUPLICATE", message: "The previous code or tag already belongs to an asset: link to it or skip the row." });
    await client.query(`UPDATE tenant.asset_opening_rows SET data = $2, status = $3, errors = $4, warnings = $5, matches = $6, updated_by = $7 WHERE id = $1`,
      [row.id, JSON.stringify({ ...result.data, corrections }), status, JSON.stringify(result.errors), JSON.stringify(result.warnings), JSON.stringify(result.matches), c.userId]);
  }
  return refreshCounts(client, batch.id);
}
async function refreshCounts(client, batchId) {
  const n = (await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('REGISTERED', 'LINKED'))::int AS done, count(*) FILTER (WHERE status IN ('INVALID', 'DUPLICATE', 'PENDING'))::int AS open,
      count(*) FILTER (WHERE status = 'VALID')::int AS ready FROM tenant.asset_opening_rows WHERE batch_id = $1`, [batchId])).rows[0];
  const batch = (await client.query(`SELECT status FROM tenant.asset_opening_batches WHERE id = $1`, [batchId])).rows[0];
  const status = ["REGISTERED_PENDING_FINANCE", "RECONCILED", "CLOSED", "CANCELLED"].includes(batch.status) ? batch.status : n.done > 0 ? "REGISTERED_PENDING_FINANCE" : n.open > 0 ? "NEEDS_CORRECTION" : n.ready > 0 ? "READY_FOR_CONFIRMATION" : "DRAFT";
  await client.query(`UPDATE tenant.asset_opening_batches SET row_count = $2, registered_count = $3, exception_count = $4, status = $5 WHERE id = $1`, [batchId, n.total, n.done, n.open, status]);
  return { ...n, status };
}

// ------------------------------------------------------------------ batches
// input: { cutoverDate, fileName, csv? | base64? , idempotencyKey? } — the same file twice is one batch.
export async function createOpeningBatch(client, c, input = {}) {
  requireOpening(c, OPENING.upload);
  const cutoverDate = await cutoverFor(client, c, input.cutoverDate);
  const fileName = text(input.fileName, 200) || "existing-assets.csv";
  const bytes = input.bytes ? Buffer.from(input.bytes) : input.base64 ? Buffer.from(String(input.base64), "base64") : Buffer.from(String(input.csv ?? ""), "utf8");
  if (!bytes.length) throw openingError(400, "ASSET_OPENING_INVALID", "The file is empty. Download the template.");
  if (bytes.length > 10 * 1024 * 1024) throw openingError(400, "ASSET_OPENING_INVALID", "The file is larger than 10 MB; split it.");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const existing = (await client.query(`SELECT id FROM tenant.asset_opening_batches WHERE organization_id = $1 AND file_hash = $2 AND status <> 'CANCELLED'`, [c.organizationId, hash])).rows[0];
  if (existing) return { batchId: existing.id, replayed: true };
  const { isXlsxFileName, parseXlsxUpload } = await import("../../../core/platform/data-exchange/xlsx.js");
  const { parseCsvUpload } = await import("../../../core/platform/data-exchange/csv.js");
  let parsed;
  try { parsed = isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: 5000, maxBytes: 10 * 1024 * 1024 }) : parseCsvUpload(bytes, { maxRows: 5000, maxBytes: 10 * 1024 * 1024 }); }
  catch (failure) { throw openingError(400, "ASSET_OPENING_INVALID", failure.message || "The file could not be read."); }
  if (!parsed.records.length) throw openingError(400, "ASSET_OPENING_INVALID", "The file has no data rows. Download the template.");
  const batch = (await client.query(`INSERT INTO tenant.asset_opening_batches (organization_id, source, file_name, file_hash, cutover_date, created_by) VALUES ($1,'FILE',$2,$3,$4,$5) RETURNING *`,
    [c.organizationId, fileName, hash, cutoverDate, c.userId])).rows[0];
  for (const [i, record] of parsed.records.entries()) {
    await client.query(`INSERT INTO tenant.asset_opening_rows (organization_id, batch_id, row_number, raw) VALUES ($1,$2,$3,$4)`, [c.organizationId, batch.id, i + 2, JSON.stringify(record)]);
  }
  await logEvent(client, c, batch.id, "CREATED", { fileName, rows: parsed.records.length, cutoverDate });
  const counts = await revalidate(client, c, batch);
  await logEvent(client, c, batch.id, "VALIDATED", counts);
  return { batchId: batch.id, number: `OPN-${batch.batch_number}`, ...counts };
}
// input: { cutoverDate, …one asset's fields (template names) } — one existing asset, registered at once when valid.
export async function createManualOpeningAsset(client, c, input = {}) {
  requireOpening(c, OPENING.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.asset_opening_batches WHERE organization_id = $1 AND file_hash = $2`, [c.organizationId, `manual:${key}`])).rows[0];
    if (done) return { batchId: done.id, replayed: true, ...(await rowResult(client, done.id)) };
  }
  const cutoverDate = await cutoverFor(client, c, input.cutoverDate);
  const batch = (await client.query(`INSERT INTO tenant.asset_opening_batches (organization_id, source, file_name, file_hash, cutover_date, created_by) VALUES ($1,'MANUAL','Entered by hand',$2,$3,$4) RETURNING *`,
    [c.organizationId, key ? `manual:${key}` : null, cutoverDate, c.userId])).rows[0];
  const record = Object.fromEntries(Object.entries(input).filter(([k]) => !["cutoverDate", "idempotencyKey", "resolution", "linkAssetId"].includes(k)));
  await client.query(`INSERT INTO tenant.asset_opening_rows (organization_id, batch_id, row_number, raw, resolution, link_asset_id) VALUES ($1,$2,1,$3,$4,$5)`,
    [c.organizationId, batch.id, JSON.stringify(record), input.resolution ?? null, input.linkAssetId ? uuid(input.linkAssetId, "Asset") : null]);
  await logEvent(client, c, batch.id, "CREATED", { manual: true, cutoverDate });
  const counts = await revalidate(client, c, batch);
  if (counts.ready > 0 && has(c, OPENING.register)) await registerOpeningBatch(client, c, batch.id, {});
  return { batchId: batch.id, number: `OPN-${batch.batch_number}`, ...(await rowResult(client, batch.id)) };
}
async function rowResult(client, batchId) {
  const r = (await client.query(`SELECT r.status, r.errors, r.warnings, r.matches, r.asset_id, a.asset_number FROM tenant.asset_opening_rows r LEFT JOIN tenant.assets a ON a.id = r.asset_id WHERE r.batch_id = $1 ORDER BY r.row_number LIMIT 1`, [batchId])).rows[0];
  return { status: r.status, errors: r.errors, warnings: r.warnings, matches: r.matches, assetId: r.asset_id, assetNumber: r.asset_number };
}
// input: { corrections?: { column: value }, resolution?: CREATE | LINK | SKIP, linkAssetId? } — a row corrected before registration, then revalidated.
export async function updateOpeningRow(client, c, batchId, rowNumber, input = {}) {
  requireOpening(c, OPENING.edit);
  const batch = await loadBatch(client, c, batchId, { lock: true });
  if (["CLOSED", "CANCELLED", "RECONCILED"].includes(batch.status)) throw openingError(409, "ASSET_OPENING_PERIOD_LOCKED", "This migration is closed for row changes.");
  const row = (await client.query(`SELECT * FROM tenant.asset_opening_rows WHERE batch_id = $1 AND row_number = $2 FOR UPDATE`, [batch.id, Number(rowNumber)])).rows[0];
  if (!row) throw openingError(404, "ASSET_OPENING_NOT_FOUND", "That row was not found.");
  if (["REGISTERED", "LINKED"].includes(row.status)) throw openingError(409, "ASSET_OPENING_ALREADY_REGISTERED", "This row is registered; correct the asset through its own workflows.");
  const corrections = { ...(row.data?.corrections ?? {}) };
  for (const [k, v] of Object.entries(input.corrections ?? {})) corrections[k] = String(v ?? "").slice(0, 500);
  const resolution = input.resolution === undefined ? row.resolution : input.resolution ? String(input.resolution).toUpperCase() : null;
  if (resolution && !["CREATE", "LINK", "SKIP"].includes(resolution)) throw openingError(400, "ASSET_OPENING_INVALID", "Resolve by creating, linking or skipping.");
  let link = input.linkAssetId === undefined ? row.link_asset_id : input.linkAssetId ? uuid(input.linkAssetId, "Asset") : null;
  if (resolution === "LINK" && link && !row.matches.some((m) => m.assetId === link)) {
    const ok = (await client.query(`SELECT 1 FROM tenant.assets WHERE organization_id = $1 AND id = $2`, [c.organizationId, link])).rows[0];
    if (!ok) throw openingError(400, "ASSET_OPENING_INVALID", "Choose an asset of this Company to link to.");
  }
  if (resolution !== "LINK") link = null;
  await client.query(`UPDATE tenant.asset_opening_rows SET data = jsonb_set(data, '{corrections}', $2::jsonb), resolution = $3, link_asset_id = $4, updated_by = $5 WHERE id = $1`,
    [row.id, JSON.stringify(corrections), resolution, link, c.userId]);
  await logEvent(client, c, batch.id, "ROW_CORRECTED", { row: row.row_number, corrections: Object.keys(input.corrections ?? {}), resolution });
  await revalidate(client, c, batch);
  return (await client.query(`SELECT row_number, status, errors, warnings, matches, resolution FROM tenant.asset_opening_rows WHERE id = $1`, [row.id])).rows[0];
}
export async function validateOpeningBatch(client, c, batchId) {
  requireOpening(c, OPENING.validate);
  const batch = await loadBatch(client, c, batchId, { lock: true });
  if (["CLOSED", "CANCELLED"].includes(batch.status)) throw openingError(409, "ASSET_OPENING_PERIOD_LOCKED", "This migration is closed.");
  const counts = await revalidate(client, c, batch);
  await logEvent(client, c, batch.id, "VALIDATED", counts);
  return counts;
}
// Only a batch that registered nothing may be cancelled; registered assets are corrected through their own workflows.
export async function cancelOpeningBatch(client, c, batchId, input = {}) {
  requireOpening(c, OPENING.create);
  const batch = await loadBatch(client, c, batchId, { lock: true });
  if (batch.status === "CANCELLED") return { batchId: batch.id, status: "CANCELLED", replayed: true };
  if (batch.registered_count > 0) throw openingError(409, "ASSET_OPENING_ALREADY_REGISTERED", "Assets from this migration are registered; it cannot be cancelled.");
  await client.query(`UPDATE tenant.asset_opening_batches SET status = 'CANCELLED' WHERE id = $1`, [batch.id]);
  await logEvent(client, c, batch.id, "CANCELLED", {}, { reason: text(input.reason, 500) || null });
  return { batchId: batch.id, status: "CANCELLED" };
}

// ------------------------------------------------------------------ registration
// Each ready row: create the asset (or link the existing one), set its opening baseline, propose its opening position. One row's failure
// is recorded on the row and never undoes another; registered rows are never registered again.
export async function registerOpeningBatch(client, c, batchId, input = {}) {
  requireOpening(c, OPENING.register);
  const batch = await loadBatch(client, c, batchId, { lock: true });
  versionCheck(batch, input.expectedVersion);
  if (["CLOSED", "CANCELLED", "RECONCILED"].includes(batch.status)) throw openingError(409, "ASSET_OPENING_PERIOD_LOCKED", "This migration is closed for registration.");
  if (batch.status === "REGISTERING") throw openingError(409, "ASSET_OPENING_RECOVERY_REQUIRED");
  await revalidate(client, c, batch);
  const rows = (await client.query(`SELECT * FROM tenant.asset_opening_rows WHERE batch_id = $1 AND status = 'VALID' ORDER BY row_number`, [batch.id])).rows;
  const results = [];
  for (const row of rows) {
    await client.query("SAVEPOINT opening_row");
    try {
      const assetId = row.resolution === "LINK" ? await linkRow(client, c, batch, row) : await registerRow(client, c, batch, row);
      await client.query("RELEASE SAVEPOINT opening_row");
      results.push({ row: row.row_number, ok: true, assetId });
    } catch (failure) {
      await client.query("ROLLBACK TO SAVEPOINT opening_row");
      await client.query(`UPDATE tenant.asset_opening_rows SET status = 'INVALID', errors = $2 WHERE id = $1`, [row.id, JSON.stringify([{ field: null, code: failure.code ?? "ASSET_OPENING_INVALID", message: failure.message }])]);
      results.push({ row: row.row_number, ok: false, code: failure.code, message: failure.message });
    }
  }
  const counts = await refreshCounts(client, batch.id);
  await logEvent(client, c, batch.id, "REGISTERED", { registered: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
  if (results.some((r) => r.ok)) {
    for (const userId of await usersWith(client, c, OPENING.approve)) {
      if (userId === c.userId) continue;
      await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_register", title: `Opening assets OPN-${batch.batch_number}: Finance review`,
        message: `${results.filter((r) => r.ok).length} existing asset(s) registered; their opening values wait for Finance.`, href: `/assets/opening/${batch.id}?tab=finance`, entityType: null, entityId: null });
    }
  }
  return { batchId: batch.id, results, ...counts };
}
// The authority the migration uses to establish each asset's opening status: its own registration, never a person's later decision.
const migrationContext = (c) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "assets.create", "assets.activate", "assets.status.place_hold", "assets.status.report_missing", "assets.status.confirm_lost"])] });
async function registerRow(client, c, batch, row) {
  const d = row.data;
  const { createAssetDraft, transitionAsset } = await import("../asset-register/register-commands.js");
  const status = await import("../asset-status/status-commands.js");
  const { attachLegacyCode } = await import("../asset-identification/ident-commands.js");
  const sys = migrationContext(c);
  const ref = `Opening migration OPN-${batch.batch_number}, row ${row.row_number}`;
  const position = d.position;
  const made = await status.withStatusContext(client, c, { action: "opening", locationEvent: "IMPORT", reason: ref, sourceType: "asset_opening_row", sourceId: row.id, effective: dayOfDb(batch.cutover_date) },
    () => createAssetDraft(client, sys, {
      name: d.name, categoryId: d.categoryId, serialNumber: d.serial_number || undefined, tagCode: d.asset_tag || undefined, manufacturer: d.manufacturer || undefined, model: d.model || undefined,
      capitalizationClass: d.tracking, ownership: d.ownership, acquisitionMethod: "OPENING_BALANCE", purchaseDate: d.dates.acquisition_date ?? undefined, supplierId: d.supplierId ?? undefined,
      locationId: d.disposed ? undefined : d.locationId ?? undefined, departmentId: d.departmentId ?? undefined, custodianUserId: d.custodianUserId ?? undefined, condition: d.condition ?? undefined,
      warrantyEndDate: d.dates.warranty_end_date ?? undefined, notes: [d.notes, d.purchase_reference ? `Purchase reference: ${d.purchase_reference}` : null, d.supplier && !d.supplierId ? `Supplier: ${d.supplier}` : null].filter(Boolean).join(" · ") || undefined,
      idempotencyKey: `opening:${row.id}`, acquisition: { sourceType: "OPENING_BALANCE", openingCost: position ? position.capitalizedCost : undefined, reason: ref },
    }, { batchId: null }));
  const assetId = made.assetId;
  if (d.storeId && !d.custodianUserId) {
    await status.withStatusContext(client, c, { action: "opening", reason: ref }, async () => {
      await client.query(`SELECT set_config('vercent.custody_engine', '', true)`);
      await client.query(`UPDATE tenant.assets SET current_store_location_id = $3, current_department_id = NULL WHERE organization_id = $1 AND id = $2`, [c.organizationId, assetId, d.storeId]);
    });
  }
  await transitionAsset(client, sys, assetId, "register", {});
  if (d.existing_asset_code) await attachLegacyCode(client, c, { id: assetId, legacy_asset_code: null }, d.existing_asset_code, { kind: "IMPORT", reason: ref });
  // The opening lifecycle, established once — never a fabricated history of past moves.
  if (["ACTIVE", "RETIRED", "LOST"].includes(d.lifecycle)) {
    await transitionAsset(client, sys, assetId, "activate", { availableForUseDate: d.dates.available_for_use_date ?? d.dates.acquisition_date ?? dayOfDb(batch.cutover_date) });
  } else if (d.dates.available_for_use_date) {
    await client.query(`UPDATE tenant.assets SET placed_in_service_date = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, assetId, d.dates.available_for_use_date]);
  }
  if (d.hold) await status.placeAssetOnHold(client, sys, assetId, { reasonCode: d.hold, description: `Recorded as ${String(d.status).toLowerCase()} in the earlier register (${ref}).` });
  if (d.missing) await status.reportMissingAsset(client, sys, assetId, { description: `Recorded as missing in the earlier register (${ref}).` });
  if (d.lost) {
    await status.reportMissingAsset(client, sys, assetId, { description: `Recorded as lost in the earlier register (${ref}).` });
    await status.confirmAssetLost(client, sys, assetId, { note: `Lost before the cutover according to the earlier register; verify (${ref}).` });
  }
  if (d.lifecycle === "RETIRED" || d.disposed) {
    await status.withStatusContext(client, c, { action: "opening", reason: `${d.disposed ? "Disposed" : "Retired"} before the cutover according to the earlier register (${ref}).` },
      () => client.query(`UPDATE tenant.assets SET lifecycle_status = $3, retired_at = CASE WHEN $3 = 'RETIRED' THEN $4::date ELSE retired_at END, disposed_at = CASE WHEN $3 = 'DISPOSED' THEN $5::date ELSE disposed_at END,
          availability_status = 'RESTRICTED', current_user_id = NULL WHERE organization_id = $1 AND id = $2`, [c.organizationId, assetId, d.disposed ? "DISPOSED" : "RETIRED", dayOfDb(batch.cutover_date), d.dates.disposal_date]));
  }
  if (position && !d.disposed) await proposePosition(client, c, batch, row, assetId, position, d);
  await client.query(`UPDATE tenant.asset_opening_rows SET status = 'REGISTERED', asset_id = $2 WHERE id = $1`, [row.id, assetId]);
  await recordAssetEvent(client, c, assetId, "asset.opening_registered", { batchId: batch.id, row: row.row_number, cutoverDate: dayOfDb(batch.cutover_date) });
  return assetId;
}
async function linkRow(client, c, batch, row) {
  const d = row.data;
  const asset = (await client.query(`SELECT * FROM tenant.assets WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, row.link_asset_id])).rows[0];
  if (!asset) throw openingError(404, "ASSET_OPENING_NOT_FOUND", "The asset to link to was not found.");
  const done = (await client.query(`SELECT 1 FROM tenant.asset_opening_rows WHERE asset_id = $1 AND status IN ('REGISTERED', 'LINKED')`, [asset.id])).rows[0];
  if (done) throw openingError(409, "ASSET_OPENING_ALREADY_REGISTERED", "That asset is already part of an opening migration.");
  if (d.existing_asset_code && !asset.legacy_normalized) {
    const { attachLegacyCode } = await import("../asset-identification/ident-commands.js");
    await attachLegacyCode(client, c, asset, d.existing_asset_code, { kind: "IMPORT", reason: `Opening migration OPN-${batch.batch_number}, row ${row.row_number}` });
  }
  if (d.position && asset.capitalization_class !== "CAPITALIZED" && !(await client.query(`SELECT 1 FROM tenant.asset_opening_positions WHERE asset_id = $1`, [asset.id])).rows[0]) {
    await proposePosition(client, c, batch, row, asset.id, d.position, d);
  }
  await client.query(`UPDATE tenant.asset_opening_rows SET status = 'LINKED', asset_id = $2 WHERE id = $1`, [row.id, asset.id]);
  await recordAssetEvent(client, c, asset.id, "asset.opening_linked", { batchId: batch.id, row: row.row_number });
  return asset.id;
}
async function proposePosition(client, c, batch, row, assetId, p, d) {
  await client.query(`INSERT INTO tenant.asset_opening_positions (organization_id, asset_id, batch_id, row_id, cutover_date, currency, original_cost, capitalized_cost, accumulated_depreciation, accumulated_impairment,
      other_adjustments, opening_carrying_amount, residual_value, depreciation_method, original_useful_life_months, remaining_useful_life_months, tax_reference, evidence, status, review_note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [c.organizationId, assetId, batch.id, row.id, dayOfDb(batch.cutover_date), p.currency, p.originalCost, p.capitalizedCost, p.accumulatedDepreciation, p.accumulatedImpairment, p.otherAdjustments, p.openingCarryingAmount,
      p.residualValue, p.method, p.usefulLife, p.remaining, d.tax_reference || null, d.evidence || null, p.review ? "NEEDS_REVIEW" : "PROPOSED",
      p.review ? (row.warnings ?? []).filter((w) => /VALUE|DEPRECIATION/.test(w.code)).map((w) => w.message).join(" ") || null : null, c.userId]);
}

// ------------------------------------------------------------------ Finance
const NUM = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
// input: { capitalizedCost?, accumulatedDepreciation?, accumulatedImpairment?, otherAdjustments?, residualValue?, remainingUsefulLifeMonths?, depreciationMethod?, taxReference?, reason } — before approval.
export async function updateOpeningPosition(client, c, positionId, input = {}) {
  requireOpening(c, OPENING.approve);
  const p = (await client.query(`SELECT * FROM tenant.asset_opening_positions WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(positionId, "Opening position")])).rows[0];
  if (!p) throw openingError(404, "ASSET_OPENING_NOT_FOUND", "That opening position was not found.");
  if (["APPROVED", "LOCKED"].includes(p.status)) throw openingError(409, "ASSET_OPENING_PERIOD_LOCKED", p.status === "LOCKED" ? undefined : "This position is approved; it changes only through a correction after the batch closes.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw openingError(400, "ASSET_OPENING_INVALID", "Give the reason for the change.", { field: "reason" });
  const next = computePosition(p, input);
  await client.query(`UPDATE tenant.asset_opening_positions SET capitalized_cost = $2, accumulated_depreciation = $3, accumulated_impairment = $4, other_adjustments = $5, opening_carrying_amount = $6, residual_value = $7,
      remaining_useful_life_months = $8, depreciation_method = $9, tax_reference = $10, status = 'PROPOSED', review_note = $11, version = version + 1 WHERE id = $1`,
    [p.id, next.capitalized, next.acc, next.imp, next.adj, next.carrying, next.residual, next.remaining, next.method, next.tax, `Reviewed by Finance: ${reason}`]);
  await logEvent(client, c, p.batch_id, "POSITION_REVIEWED", { before: { carrying: p.opening_carrying_amount }, after: { carrying: next.carrying } }, { assetId: p.asset_id, reason });
  return { positionId: p.id, status: "PROPOSED", openingCarryingAmount: next.carrying };
}
function computePosition(p, input) {
  const pick = (k, col) => (input[k] === undefined ? NUM(p[col]) : NUM(input[k]));
  const capitalized = pick("capitalizedCost", "capitalized_cost");
  const acc = pick("accumulatedDepreciation", "accumulated_depreciation") ?? 0;
  const imp = pick("accumulatedImpairment", "accumulated_impairment") ?? 0;
  const adj = pick("otherAdjustments", "other_adjustments") ?? 0;
  const residual = pick("residualValue", "residual_value") ?? 0;
  for (const [label, v] of [["cost", capitalized], ["accumulated depreciation", acc], ["impairment", imp], ["residual value", residual]]) {
    if (v === null || !Number.isFinite(v) || v < 0) throw openingError(400, "ASSET_OPENING_VALUE_MISMATCH", `Enter the ${label} as 0 or more.`);
  }
  const carrying = Math.round((capitalized - acc - imp + adj) * 100) / 100;
  if (carrying < 0) throw openingError(400, "ASSET_OPENING_VALUE_MISMATCH");
  if (residual > carrying + 0.001 && carrying > 0) throw openingError(400, "ASSET_OPENING_DEPRECIATION_INVALID", "The residual value is above the carrying value.");
  const remaining = input.remainingUsefulLifeMonths === undefined ? p.remaining_useful_life_months : input.remainingUsefulLifeMonths === null || input.remainingUsefulLifeMonths === "" ? null : Number(input.remainingUsefulLifeMonths);
  if (remaining !== null && (!Number.isInteger(remaining) || remaining < 0)) throw openingError(400, "ASSET_OPENING_DEPRECIATION_INVALID", "Remaining useful life is whole months.");
  return { capitalized: capitalized.toFixed(2), acc: acc.toFixed(2), imp: imp.toFixed(2), adj: adj.toFixed(2), carrying: carrying.toFixed(2), residual: residual.toFixed(2), remaining,
    method: input.depreciationMethod ?? p.depreciation_method, tax: input.taxReference === undefined ? p.tax_reference : text(input.taxReference, 200) || null };
}
// Finance's opening balances not yet posted: a draft for Finance's own opening-balance workflow — asset cost debit and accumulated
// depreciation credit per account. Finance completes, submits and posts it once; this never posts.
export async function prepareFinanceOpeningBalance(client, c, batchId) {
  requireOpening(c, OPENING.approve);
  const batch = await loadBatch(client, c, batchId, { lock: true });
  if (batch.finance_opening_balance_id) return { batchId: batch.id, openingBalanceId: batch.finance_opening_balance_id, replayed: true };
  const { getOpeningReconciliation } = await import("./opening-read.js");
  const rec = await getOpeningReconciliation(client, c, batch.id);
  if (rec.lines.some((l) => Number(l.finance) !== 0)) throw openingError(409, "ASSET_OPENING_ALREADY_POSTED", "Finance's opening balances already include these accounts; link to them instead of preparing new ones.");
  const lines = rec.lines.filter((l) => l.accountId && Number(l.register) !== 0).map((l) => ({ accountId: l.accountId, debit: l.side === "DEBIT" ? l.register : "0", credit: l.side === "CREDIT" ? l.register : "0",
    description: `Opening ${l.measure.toLowerCase()} — assets migration OPN-${batch.batch_number}` }));
  if (!lines.length) throw openingError(409, "ASSET_OPENING_FINANCE_MISMATCH", "No opening value has a Finance account: set the categories' financial policy first.");
  const { saveOpeningBalances } = await import("../../accounting/finance-documents.js");
  const doc = await saveOpeningBalances(client, c, { asOfDate: dayOfDb(batch.cutover_date), description: `Fixed assets brought forward — migration OPN-${batch.batch_number}`, lines });
  const id = doc.id;
  await client.query(`UPDATE tenant.asset_opening_batches SET finance_opening_balance_id = $2, finance_mode = 'PREPARED' WHERE id = $1`, [batch.id, id]);
  await logEvent(client, c, batch.id, "FINANCE_PREPARED", { openingBalanceId: id, lines: lines.length });
  return { batchId: batch.id, openingBalanceId: id, documentNumber: doc.number ?? null };
}
// input: { mode: LINKED | PREPARED, varianceReason? } — Finance approves the opening position (never the person who started the migration):
// the assets take their opening values and depreciation continues from them, prospectively.
export async function approveOpeningFinancials(client, c, batchId, input = {}) {
  requireOpening(c, OPENING.approve);
  const batch = await loadBatch(client, c, batchId, { lock: true });
  versionCheck(batch, input.expectedVersion);
  if (batch.status === "RECONCILED" || batch.status === "CLOSED") return { batchId: batch.id, status: batch.status, replayed: true };
  if (batch.status !== "REGISTERED_PENDING_FINANCE") throw openingError(409, "ASSET_OPENING_INVALID", "Register the assets first.");
  if (batch.created_by === c.userId) throw openingError(403, "ASSET_OPENING_PERMISSION_DENIED", "The person who started the migration cannot approve its opening values.");
  const review = (await client.query(`SELECT count(*)::int AS n FROM tenant.asset_opening_positions WHERE batch_id = $1 AND status = 'NEEDS_REVIEW'`, [batch.id])).rows[0].n;
  if (review) throw openingError(409, "ASSET_OPENING_VALUE_MISMATCH", `${review} opening position(s) still need Finance review.`);
  const mode = String(input.mode ?? (batch.finance_opening_balance_id ? "PREPARED" : "LINKED")).toUpperCase();
  if (!["LINKED", "PREPARED"].includes(mode)) throw openingError(400, "ASSET_OPENING_INVALID", "Choose whether Finance's balances are already posted (linked) or prepared from this migration.");
  if (mode === "PREPARED" && !batch.finance_opening_balance_id) throw openingError(409, "ASSET_OPENING_INVALID", "Prepare Finance's opening balance first.");
  const { getOpeningReconciliation } = await import("./opening-read.js");
  const rec = await getOpeningReconciliation(client, c, batch.id);
  const variance = text(input.varianceReason, 1000);
  if (mode === "LINKED" && !rec.matched && variance.length < 3) throw openingError(409, "ASSET_OPENING_FINANCE_MISMATCH", "The asset totals do not agree with Finance's opening balances; correct them or record why the difference is accepted.", { lines: rec.lines });
  const positions = (await client.query(`SELECT p.*, a.category_id, a.acquisition_date, a.placed_in_service_date FROM tenant.asset_opening_positions p JOIN tenant.assets a ON a.id = p.asset_id WHERE p.batch_id = $1 FOR UPDATE OF p`, [batch.id])).rows;
  const { onOpeningApproved } = await import("../asset-depreciation/dp-commands.js");
  const start = new Date(Date.parse(`${dayOfDb(batch.cutover_date)}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  for (const p of positions) {
    const remaining = Number(p.remaining_useful_life_months ?? 0);
    await client.query(`UPDATE tenant.assets SET capitalization_class = 'CAPITALIZED', capitalized_cost = $3, accumulated_depreciation = $4, impairment_accumulated = $5, net_book_value = $6, residual_value = $7,
        useful_life_months = $8, depreciation_method = COALESCE($9, depreciation_method), depreciation_start_date = $10, capitalization_date = COALESCE(placed_in_service_date, acquisition_date, $11::date),
        capitalized_by = $12, capitalized_at = clock_timestamp(), accounting_status = 'not_required' WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, p.asset_id, p.capitalized_cost, p.accumulated_depreciation, p.accumulated_impairment, p.opening_carrying_amount, p.residual_value, Math.max(remaining, 1), p.depreciation_method, start,
        dayOfDb(batch.cutover_date), c.userId]);
    // Depreciation continues from the approved carrying value over the remaining life — historical depreciation is never repeated.
    if ((p.depreciation_method ?? "straight_line") === "straight_line") await onOpeningApproved(client, c, p.asset_id, { positionId: p.id });
    await recordAssetEvent(client, c, p.asset_id, "asset.opening_values_approved", { batchId: batch.id, carrying: String(p.opening_carrying_amount), note: "Opening position approved; no journal is posted from Assets." });
  }
  await client.query(`UPDATE tenant.asset_opening_positions SET status = 'APPROVED', approved_by = $2, approved_at = clock_timestamp() WHERE batch_id = $1`, [batch.id, c.userId]);
  await client.query(`UPDATE tenant.asset_opening_batches SET status = 'RECONCILED', finance_mode = $2, variance_note = $3, approved_by = $4, approved_at = clock_timestamp() WHERE id = $1`, [batch.id, mode, variance || null, c.userId]);
  await logEvent(client, c, batch.id, "FINANCE_APPROVED", { mode, positions: positions.length, matched: rec.matched }, { reason: variance || null });
  return { batchId: batch.id, status: "RECONCILED", mode, positions: positions.length };
}
// Locks the approved opening values and the Company's cutover. Later changes are corrections.
export async function closeOpeningBatch(client, c, batchId) {
  requireOpening(c, OPENING.close);
  const batch = await loadBatch(client, c, batchId, { lock: true });
  if (batch.status === "CLOSED") return { batchId: batch.id, status: "CLOSED", replayed: true };
  if (batch.status !== "RECONCILED") throw openingError(409, "ASSET_OPENING_INVALID", "Finance approves the opening values before the migration is closed.");
  await client.query(`UPDATE tenant.asset_opening_positions SET status = 'LOCKED' WHERE batch_id = $1`, [batch.id]);
  await client.query(`UPDATE tenant.asset_opening_batches SET status = 'CLOSED', closed_by = $2, closed_at = clock_timestamp() WHERE id = $1`, [batch.id, c.userId]);
  await client.query(`INSERT INTO tenant.asset_settings (organization_id, opening_cutover_date) VALUES ($1, $2)
      ON CONFLICT (organization_id) DO UPDATE SET opening_cutover_date = COALESCE(tenant.asset_settings.opening_cutover_date, EXCLUDED.opening_cutover_date)`, [c.organizationId, dayOfDb(batch.cutover_date)]);
  await logEvent(client, c, batch.id, "CLOSED", {});
  return { batchId: batch.id, status: "CLOSED" };
}
// input: { …values, reason, evidence } — an authorized correction to a locked opening position: recorded, versioned, applied to the
// asset as a difference; any accounting adjustment is Finance's own entry.
export async function correctOpeningPosition(client, c, positionId, input = {}) {
  requireOpening(c, OPENING.correct);
  const p = (await client.query(`SELECT * FROM tenant.asset_opening_positions WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(positionId, "Opening position")])).rows[0];
  if (!p) throw openingError(404, "ASSET_OPENING_NOT_FOUND", "That opening position was not found.");
  if (p.status !== "LOCKED") throw openingError(409, "ASSET_OPENING_INVALID", "Only a locked position is corrected; change it in Finance review before approval.");
  const reason = text(input.reason, 1000);
  const evidence = text(input.evidence, 500);
  if (reason.length < 3 || evidence.length < 3) throw openingError(400, "ASSET_OPENING_INVALID", "Give the reason and the evidence for the correction.");
  const next = computePosition(p, input);
  const delta = (k) => (Number(next[k]) - Number(p[{ capitalized: "capitalized_cost", acc: "accumulated_depreciation", imp: "accumulated_impairment" }[k]])).toFixed(2);
  await client.query(`SELECT set_config('vercent.opening_correction', 'on', true)`);
  try {
    await client.query(`UPDATE tenant.asset_opening_positions SET capitalized_cost = $2, accumulated_depreciation = $3, accumulated_impairment = $4, other_adjustments = $5, opening_carrying_amount = $6, residual_value = $7,
        remaining_useful_life_months = $8, version = version + 1, review_note = $9 WHERE id = $1`, [p.id, next.capitalized, next.acc, next.imp, next.adj, next.carrying, next.residual, next.remaining, `Corrected: ${reason} (${evidence})`]);
  } finally { await client.query(`SELECT set_config('vercent.opening_correction', '', true)`); }
  await client.query(`UPDATE tenant.assets SET capitalized_cost = capitalized_cost + $3::numeric, accumulated_depreciation = accumulated_depreciation + $4::numeric, impairment_accumulated = impairment_accumulated + $5::numeric,
      net_book_value = GREATEST(0, net_book_value + $3::numeric - $4::numeric - $5::numeric) WHERE organization_id = $1 AND id = $2`, [c.organizationId, p.asset_id, delta("capitalized"), delta("acc"), delta("imp")]);
  await logEvent(client, c, p.batch_id, "POSITION_CORRECTED", { version: p.version + 1, before: { cost: p.capitalized_cost, accumulated: p.accumulated_depreciation, carrying: p.opening_carrying_amount },
    after: { cost: next.capitalized, accumulated: next.acc, carrying: next.carrying } }, { assetId: p.asset_id, reason: `${reason} — evidence: ${evidence}` });
  await recordAssetEvent(client, c, p.asset_id, "asset.opening_values_corrected", { reason, evidence });
  return { positionId: p.id, version: p.version + 1, note: "Recorded. Post the matching adjustment in Finance; nothing is posted from Assets." };
}
