// Assets — Asset Disposal, the commands: a disposal case for one asset or many (each checked against its real state), approval by policy
// (operational, Finance, management — never by the requester, and again after a material change), the physical exit or confirmed loss per
// asset, the Sales Invoice of a sale, Finance's carrying value and derecognition (exactly once per asset and book, recovered — never repeated —
// when its outcome is unknown), completion per asset, cancellation, correction with reinstatement, and the reconciliation queue.
import { createHash } from "node:crypto";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { has, loadSettings, nextNumber, recordAssetEvent, text, uuid } from "../common.js";
import { postAssetJournal, reverseAssetJournal, accountingAvailable } from "../accounting-bridge.js";
import { normalizeIdentifier } from "../asset-identification/ident-rules.js";
import { DX, EXECUTING, FINANCE_POST, LIVE_LINE, REASONS, TYPES, WITH_PROCEEDS, caseStatusOf, dayOfDb, dxError, fromPaise, requireDx, toPaise } from "./dx-rules.js";
import { executionIssuesOf } from "./dx-execution.js";
import { assertBalanced, basisSourceOf, considerationOf, costsOf, insertSnapshot, journalAgrees, journalLinesOf } from "./dx-financial.js";

const today = () => new Date().toISOString().slice(0, 10);
const CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"];
const LIVE_BILL = ["posted", "partially_paid", "paid", "overdue", "disputed"];
const oneOf = (v, allowed, fallback, field) => {
  const x = v === undefined || v === null || v === "" ? fallback : String(v).toUpperCase();
  if (!allowed.includes(x)) throw dxError(400, "ASSET_DISPOSAL_INVALID", `Choose a valid ${field}.`, { field });
  return x;
};
const dayOf = (v, field, { required = false } = {}) => {
  if (v === undefined || v === null || v === "") { if (required) throw dxError(400, "ASSET_DISPOSAL_INVALID", `Enter the ${field}.`, { field }); return null; }
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw dxError(400, "ASSET_DISPOSAL_INVALID", `Enter a valid ${field}.`, { field });
  return s;
};
const amountOf = (v, field) => {
  if (v === undefined || v === null || v === "") return "0.00";
  const p = toPaise(v);
  if (p < 0n) throw dxError(400, "ASSET_DISPOSAL_INVALID", `Enter a valid ${field}.`, { field });
  return fromPaise(p);
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

export async function logDisposalEvent(client, c, refs, action, { from = null, to = null, details = {}, reason = null, commandId = null } = {}) {
  await client.query(`INSERT INTO tenant.asset_disposal_events (organization_id, case_id, line_id, asset_id, action, from_status, to_status, details, reason, actor_user_id, command_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [c.organizationId, refs.caseId ?? null, refs.lineId ?? null, refs.assetId ?? null, action, from, to, JSON.stringify(details), reason, c.userId ?? null, commandId]);
}
const replayed = async (client, c, commandId) => commandId && (await client.query(`SELECT 1 FROM tenant.asset_disposal_events WHERE organization_id = $1 AND command_id = $2`, [c.organizationId, commandId])).rows[0];
async function notify(client, c, userIds, title, message, caseId) {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    if (userId === c.userId) continue;
    await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_disposal", title, message, href: `/assets/disposals/${caseId}`, entityType: "asset_disposal", entityId: caseId });
  }
}
async function usersWith(client, c, permission) {
  return (await client.query(`SELECT DISTINCT a.user_id FROM public.user_role_assignments a JOIN public.role_permissions p ON p.role_id = a.role_id
      WHERE a.organization_id = $1 AND a.status = 'active' AND p.permission_key = $2`, [c.organizationId, permission])).rows.map((r) => r.user_id);
}

// ------------------------------------------------------------------ the asset and what stands in the way
async function findAsset(client, c, ref) {
  if (ref?.assetId) {
    let id;
    try { id = uuid(ref.assetId, "Asset"); } catch { throw dxError(400, "ASSET_DISPOSAL_ASSET_INVALID"); }
    const a = (await client.query(`SELECT a.*, tenant.asset_effective_availability(a) AS effective FROM tenant.assets a WHERE a.id = $1`, [id])).rows[0];
    if (!a) throw dxError(404, "ASSET_DISPOSAL_ASSET_INVALID");
    if (a.organization_id !== c.organizationId) throw dxError(403, "ASSET_DISPOSAL_COMPANY_MISMATCH");
    return a;
  }
  const raw = text(ref?.asset ?? ref, 200);
  const n = normalizeIdentifier(raw);
  const a = n ? (await client.query(`SELECT a.*, tenant.asset_effective_availability(a) AS effective FROM tenant.assets a WHERE a.organization_id = $1
      AND (upper(a.asset_number) = upper($2) OR a.serial_normalized = $3 OR a.tag_normalized = $3 OR a.legacy_normalized = $3 OR ('VLAST:' || a.qr_token) = $2) ORDER BY (upper(a.asset_number) = upper($2)) DESC LIMIT 1`,
    [c.organizationId, raw, n])).rows[0] : null;
  if (!a) throw dxError(404, "ASSET_DISPOSAL_ASSET_INVALID", `No asset matches ${raw || "that"}.`);
  return a;
}
const custodyOf = async (client, assetId) => (await client.query(`SELECT k.*, COALESCE(NULLIF(u.full_name, ''), u.email, d.name, s.name) AS label FROM tenant.asset_custody_assignments k
    LEFT JOIN public.users u ON u.id = k.user_id LEFT JOIN public.departments d ON d.id = k.department_id LEFT JOIN tenant.asset_locations s ON s.id = k.store_location_id
    WHERE k.asset_id = $1 AND k.status = 'ACTIVE'`, [assetId])).rows[0] ?? null;
const transferOf = async (client, assetId) => (await client.query(`SELECT o.id, o.transfer_number, l.line_status, o.reason_code FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id
    WHERE l.asset_id = $1 AND l.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS') LIMIT 1`, [assetId])).rows[0] ?? null;
const maintenanceOf = async (client, assetId) => (await client.query(`SELECT id, work_order_number, status FROM tenant.asset_maintenance_work_orders WHERE asset_id = $1
    AND status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS', 'WAITING_FOR_PARTS', 'WAITING_FOR_VENDOR', 'WORK_COMPLETED', 'PENDING_VERIFICATION', 'RECOVERY_REQUIRED')`, [assetId])).rows;
const incidentOf = async (client, assetId) => (await client.query(`SELECT * FROM tenant.asset_missing_incidents WHERE asset_id = $1 ORDER BY reported_at DESC LIMIT 1`, [assetId])).rows[0] ?? null;
const liveLineOf = async (client, assetId, exceptLineId = null) => (await client.query(`SELECT l.id, c.case_number FROM tenant.asset_disposal_lines l JOIN tenant.asset_disposal_cases c ON c.id = l.case_id
    WHERE l.asset_id = $1 AND l.line_status = ANY($2::text[]) AND ($3::uuid IS NULL OR l.id <> $3)`, [assetId, LIVE_LINE, exceptLineId])).rows[0] ?? null;
// May this asset be disposed of this way? Blockers stop the request; warnings are what must be resolved before its physical exit.
export async function eligibilityOf(client, c, a, type, { exceptLineId = null } = {}) {
  const blockers = []; const warnings = [];
  const block = (code, message) => blockers.push({ code, message }); const warn = (code, message) => warnings.push({ code, message });
  if (a.lifecycle_status === "DISPOSED" || a.status === "disposed") block("ASSET_DISPOSAL_ALREADY_COMPLETED", `${a.asset_number} has already been disposed of.`);
  else if (a.archived_at) block("ASSET_DISPOSAL_ASSET_INVALID", `${a.asset_number} is archived.`);
  else if (a.lifecycle_status === "DRAFT") block("ASSET_DISPOSAL_ASSET_INVALID", `${a.asset_number} is a draft, not yet a registered asset.`);
  const live = await liveLineOf(client, a.id, exceptLineId);
  if (live) block("ASSET_DISPOSAL_ALREADY_ACTIVE", `${a.asset_number} is already in disposal ${live.case_number}.`);
  if (["leased", "loaned"].includes(a.ownership)) block("ASSET_DISPOSAL_ASSET_INVALID", `${a.asset_number} is ${a.ownership}: return it under its contract instead of disposing of it.`);
  const components = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.assets WHERE parent_asset_id = $1 AND lifecycle_status <> 'DISPOSED'`, [a.id])).rows[0].n);
  if (components) block("ASSET_DISPOSAL_INVALID", `${a.asset_number} has ${components} component asset${components === 1 ? "" : "s"}; dispose of or detach them first.`);
  const incident = await incidentOf(client, a.id);
  if (type === "WRITE_OFF_LOST" && !(a.lifecycle_status === "LOST" && incident?.status === "CONFIRMED_LOST")) block("ASSET_DISPOSAL_HANDOVER_REQUIRED", `${a.asset_number}: a loss write-off needs a confirmed loss (its missing-asset report decided as lost).`);
  if (type !== "WRITE_OFF_LOST" && a.lifecycle_status === "LOST") block("ASSET_DISPOSAL_INVALID", `${a.asset_number} is lost: it is written off as lost, or recovered first.`);
  if (incident?.status === "OPEN") warn("ASSET_DISPOSAL_INVALID", `${a.asset_number} has an open missing-asset report.`);
  const holder = await custodyOf(client, a.id);
  if (holder && ["EMPLOYEE", "DEPARTMENT"].includes(holder.custodian_type) && type !== "WRITE_OFF_LOST") warn("ASSET_DISPOSAL_CUSTODY_UNRESOLVED", `${a.asset_number} is held by ${holder.label}; it is returned (or an authorized exception recorded) before its exit.`);
  const transfer = await transferOf(client, a.id);
  if (transfer && transfer.reason_code !== "DISPOSAL_MOVEMENT") warn("ASSET_DISPOSAL_TRANSFER_ACTIVE", `Transfer ${transfer.transfer_number} is still in progress.`);
  const work = await maintenanceOf(client, a.id);
  if (work.length) warn("ASSET_DISPOSAL_MAINTENANCE_ACTIVE", `Maintenance ${work.map((w) => w.work_order_number).join(", ")} is open; it is completed or superseded at approval.`);
  if (a.lifecycle_status === "ON_HOLD") warn("ASSET_DISPOSAL_INVALID", `${a.asset_number} is on hold: review the hold's reason.`);
  if (a.capitalization_class === "PENDING") warn("ASSET_DISPOSAL_CARRYING_VALUE_UNCONFIRMED", `${a.asset_number}'s cost is not yet confirmed by Finance.`);
  return { blockers, warnings, holder, incident };
}
// input: { assets: [{ assetId | asset }], disposalType } — every asset checked; nothing is saved.
export async function validateDisposalEligibility(client, c, input = {}) {
  if (!has(c, DX.create) && !has(c, DX.view)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const type = oneOf(input.disposalType, TYPES, "SCRAP", "disposal type");
  const out = [];
  for (const ref of Array.isArray(input.assets) ? input.assets : []) {
    try {
      const a = await findAsset(client, c, ref);
      const e = await eligibilityOf(client, c, a, type);
      out.push({ assetId: a.id, asset: `${a.asset_number} · ${a.name}`, lifecycle: a.lifecycle_status, capitalization: a.capitalization_class, custodian: e.holder?.label ?? null, ok: !e.blockers.length,
        blockers: e.blockers, warnings: e.warnings });
    } catch (error) {
      out.push({ input: ref, ok: false, blockers: [{ code: error.code ?? "ASSET_DISPOSAL_ASSET_INVALID", message: error.message }], warnings: [] });
    }
  }
  return { eligible: out.filter((x) => x.ok).length, blocked: out.filter((x) => !x.ok).length, lines: out };
}

// ------------------------------------------------------------------ the case
const loadCase = async (client, c, caseId, { lock = true } = {}) => {
  let id;
  try { id = uuid(caseId, "Disposal"); } catch { throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND"); }
  const k = (await client.query(`SELECT * FROM tenant.asset_disposal_cases WHERE organization_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
  if (!k) throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND");
  return k;
};
const linesOf = async (client, caseId, { lock = false } = {}) => (await client.query(`SELECT l.*, a.asset_number, a.name AS asset_name, a.capitalization_class FROM tenant.asset_disposal_lines l JOIN tenant.assets a ON a.id = l.asset_id
    WHERE l.case_id = $1 ORDER BY l.line_number ${lock ? "FOR UPDATE OF l" : ""}`, [caseId])).rows;
const versionCheck = (k, expected) => { if (expected !== undefined && expected !== null && Number(expected) !== k.row_version) throw dxError(409, "ASSET_DISPOSAL_VERSION_CONFLICT"); };
async function refreshCase(client, k) {
  const lines = await linesOf(client, k.id);
  const status = caseStatusOf(lines, k.status);
  if (status !== k.status) await client.query(`UPDATE tenant.asset_disposal_cases SET status = $2, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [k.id, status]);
  return status;
}
async function caseFields(client, c, input, base = {}) {
  const pick = (k, d) => (input[k] !== undefined ? input[k] : base[k] ?? d);
  const type = oneOf(pick("disposalType"), TYPES, null, "disposal type");
  const reasonCode = oneOf(pick("reasonCode"), Object.keys(REASONS), "OTHER", "reason");
  const explanation = text(pick("explanation"), 2000);
  if (explanation.length < 5) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Explain why the asset is being disposed of.", { field: "explanation" });
  const effective = dayOf(pick("proposedEffectiveDate", today()), "intended disposal date", { required: true });
  let buyer = null;
  if (pick("buyerPartyId")) {
    try { buyer = uuid(pick("buyerPartyId"), "Buyer"); } catch { throw dxError(400, "ASSET_DISPOSAL_INVALID", "Choose a valid buyer.", { field: "buyerPartyId" }); }
    if (!(await client.query(`SELECT 1 FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [c.organizationId, buyer])).rows[0]) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Choose a customer of this Company as the buyer.", { field: "buyerPartyId" });
  }
  let recycler = null;
  if (pick("recyclerSupplierId")) {
    try { recycler = uuid(pick("recyclerSupplierId"), "Recycler"); } catch { throw dxError(400, "ASSET_DISPOSAL_INVALID", "Choose a valid recycler.", { field: "recyclerSupplierId" }); }
    if (!(await client.query(`SELECT 1 FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [c.organizationId, recycler])).rows[0]) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Choose a supplier of this Company as the recycler.", { field: "recyclerSupplierId" });
  }
  if (type === "DONATION" && !text(pick("recipientName"), 200)) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Name the organization receiving the donation.", { field: "recipientName" });
  return { type, reasonCode, explanation, effective, buyer, recycler, recipient: text(pick("recipientName"), 200) || null, destination: text(pick("destination"), 500) || null, relatedParty: pick("relatedParty") === true || pick("relatedParty") === "true" };
}
async function lineSnapshot(client, c, a, ref, type) {
  const e = await eligibilityOf(client, c, a, type);
  if (e.blockers.length) return { error: e.blockers[0], blockers: e.blockers };
  const loc = a.location_id ? (await client.query(`SELECT name FROM tenant.asset_locations WHERE id = $1`, [a.location_id])).rows[0]?.name ?? null : null;
  const proceeds = WITH_PROCEEDS.includes(type) ? amountOf(ref.proposedProceeds, "proposed proceeds") : "0.00";
  if (!WITH_PROCEEDS.includes(type) && ref.proposedProceeds && toPaise(ref.proposedProceeds) > 0n) return { error: { code: "ASSET_DISPOSAL_INVALID", message: `A ${type.toLowerCase().replace(/_/g, " ")} has no proceeds.` } };
  return { asset: a, holder: e.holder, incident: e.incident, warnings: e.warnings, location: loc, proceeds, costs: amountOf(ref.disposalCosts, "disposal costs"),
    condition: ref.condition ? oneOf(ref.condition, CONDITIONS, null, "condition") : (a.condition ?? null) };
}
async function insertLine(client, c, caseId, n, s) {
  return (await client.query(`INSERT INTO tenant.asset_disposal_lines (organization_id, case_id, line_number, asset_id, line_status, lifecycle_snapshot, capitalization_snapshot, custody_snapshot_id, custodian_label,
      location_snapshot_id, location_label, missing_incident_id, condition_at_disposal, proposed_proceeds, disposal_costs) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [c.organizationId, caseId, n, s.asset.id, s.asset.lifecycle_status, s.asset.capitalization_class, s.holder?.id ?? null, s.holder?.label ?? null, s.asset.location_id, s.location,
      s.incident?.status === "CONFIRMED_LOST" ? s.incident.id : null, s.condition, s.proceeds, s.costs])).rows[0];
}
// input: { disposalType, reasonCode, explanation, proposedEffectiveDate, assets: [{ assetId | asset, proposedProceeds?, disposalCosts?, condition? }], buyerPartyId?, recipientName?,
//   recyclerSupplierId?, destination?, relatedParty?, skipBlocked?, submit?, idempotencyKey? }
export async function createAssetDisposalCase(client, c, input = {}) {
  requireDx(c, DX.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT * FROM tenant.asset_disposal_cases WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { caseId: done.id, number: done.case_number, status: done.status, replayed: true };
  }
  const f = await caseFields(client, c, input);
  const refs = Array.isArray(input.assets) ? input.assets : input.assetId || input.asset ? [{ assetId: input.assetId, asset: input.asset, proposedProceeds: input.proposedProceeds, disposalCosts: input.disposalCosts, condition: input.condition }] : [];
  if (!refs.length) throw dxError(400, "ASSET_DISPOSAL_ASSET_INVALID");
  if (refs.length > 1) requireDx(c, DX.bulk);
  if (refs.length > 500) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Dispose of at most 500 assets in one case.");
  const ok = []; const blocked = []; const seen = new Set();
  for (const ref of refs) {
    let a;
    try { a = await findAsset(client, c, ref); } catch (error) { blocked.push({ input: ref, code: error.code, message: error.message }); continue; }
    if (seen.has(a.id)) { blocked.push({ input: ref, assetId: a.id, code: "ASSET_DISPOSAL_INVALID", message: `${a.asset_number} is listed twice.` }); continue; }
    seen.add(a.id);
    await client.query(`SELECT 1 FROM tenant.assets WHERE id = $1 FOR UPDATE`, [a.id]);
    const s = await lineSnapshot(client, c, a, ref, f.type);
    if (s.error) blocked.push({ input: ref, assetId: a.id, asset: a.asset_number, code: s.error.code, message: s.error.message }); else ok.push(s);
  }
  if (!ok.length) throw dxError(409, blocked[0]?.code ?? "ASSET_DISPOSAL_ASSET_INVALID", blocked[0]?.message, { lines: blocked });
  if (blocked.length && input.skipBlocked !== true) throw dxError(409, blocked[0].code, `${blocked.length} asset${blocked.length === 1 ? "" : "s"} cannot be disposed of: ${blocked[0].message}`, { lines: blocked });
  const number = await nextNumber(client, c, "asset_disposal_case", "ADP");
  const k = (await client.query(`INSERT INTO tenant.asset_disposal_cases (organization_id, case_number, disposal_type, reason_code, explanation, proposed_effective_date, buyer_party_id, recipient_name, recycler_supplier_id,
      destination, related_party, is_bulk, requested_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [c.organizationId, number, f.type, f.reasonCode, f.explanation, f.effective, f.buyer, f.recipient, f.recycler, f.destination, f.relatedParty, ok.length > 1, c.userId, key])).rows[0];
  const lines = [];
  for (const [i, s] of ok.entries()) {
    const l = await insertLine(client, c, k.id, i + 1, s);
    lines.push({ lineId: l.id, assetId: s.asset.id, asset: s.asset.asset_number, warnings: s.warnings });
    await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: s.asset.id }, "LINE_ADDED", { details: { warnings: s.warnings.map((w) => w.code) } });
  }
  await logDisposalEvent(client, c, { caseId: k.id }, "CASE_CREATED", { to: "DRAFT", details: { type: f.type, assets: ok.length, skipped: blocked.length } });
  let status = "DRAFT";
  if (input.submit === true) status = (await submitAssetDisposal(client, c, k.id, {})).status;
  return { caseId: k.id, number, status, lines, blocked };
}
// input: { …case fields, assets? (replaces the lines), expectedVersion? } — a draft, or a case sent back for changes.
export async function updateAssetDisposalCase(client, c, caseId, input = {}) {
  requireDx(c, DX.create);
  const k = await loadCase(client, c, caseId);
  versionCheck(k, input.expectedVersion);
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(k.status)) throw dxError(409, "ASSET_DISPOSAL_INVALID", "Only a draft or a case sent back for changes is edited; a submitted case is amended.");
  const f = await caseFields(client, c, input, { disposalType: k.disposal_type, reasonCode: k.reason_code, explanation: k.explanation, proposedEffectiveDate: dayOfDb(k.proposed_effective_date),
    buyerPartyId: k.buyer_party_id, recyclerSupplierId: k.recycler_supplier_id, recipientName: k.recipient_name, destination: k.destination, relatedParty: k.related_party });
  await client.query(`UPDATE tenant.asset_disposal_cases SET disposal_type = $2, reason_code = $3, explanation = $4, proposed_effective_date = $5, buyer_party_id = $6, recycler_supplier_id = $7, recipient_name = $8,
      destination = $9, related_party = $10, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`,
    [k.id, f.type, f.reasonCode, f.explanation, f.effective, f.buyer, f.recycler, f.recipient, f.destination, f.relatedParty]);
  if (Array.isArray(input.assets)) {
    const existing = await linesOf(client, k.id, { lock: true });
    for (const l of existing) await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'CANCELLED', row_version = row_version + 1 WHERE id = $1`, [l.id]);
    let n = Math.max(0, ...existing.map((l) => l.line_number));
    for (const ref of input.assets) {
      const a = await findAsset(client, c, ref);
      const s = await lineSnapshot(client, c, a, ref, f.type);
      if (s.error) throw dxError(409, s.error.code, s.error.message);
      n += 1;
      await insertLine(client, c, k.id, n, s);
    }
    if ((await linesOf(client, k.id)).filter((l) => l.line_status === "DRAFT").length > 1) requireDx(c, DX.bulk);
  }
  await logDisposalEvent(client, c, { caseId: k.id }, "CASE_EDITED", { details: { lines: Array.isArray(input.assets) ? input.assets.length : undefined } });
  return { caseId: k.id, status: k.status };
}

// ------------------------------------------------------------------ approval policy
async function basisOf(client, k) {
  const lines = (await linesOf(client, k.id)).filter((l) => LIVE_LINE.includes(l.line_status));
  return { lines, basis: hash({ type: k.disposal_type, effective: dayOfDb(k.proposed_effective_date), buyer: k.buyer_party_id, recipient: k.recipient_name, recycler: k.recycler_supplier_id, related: k.related_party,
    lines: lines.map((l) => [l.asset_id, String(l.proposed_proceeds), String(l.disposal_costs)]) }) };
}
// Which approvals this case needs: an asset approval always; Finance for anything capitalized, any proceeds, a donation or write-off;
// management (a second, different approver) at or above the Company's threshold, for a donation or a related-party sale.
async function policyOf(client, c, k, lines) {
  const settings = await loadSettings(client, c);
  let total = 0n;
  for (const l of lines) {
    const a = (await client.query(`SELECT capitalized_cost, accumulated_depreciation, impairment_accumulated, capitalization_class FROM tenant.assets WHERE id = $1`, [l.asset_id])).rows[0];
    if (a.capitalization_class !== "TRACKED_ONLY") total += toPaise(a.capitalized_cost ?? 0) - toPaise(a.accumulated_depreciation ?? 0) - toPaise(a.impairment_accumulated ?? 0);
  }
  const capitalized = lines.some((l) => l.capitalization_class !== "TRACKED_ONLY");
  const proceeds = lines.some((l) => toPaise(l.proposed_proceeds) > 0n);
  const levels = ["OPERATIONAL"];
  if (capitalized || proceeds || ["DONATION", "WRITE_OFF_LOST", "WRITE_OFF_DAMAGED", "OTHER_APPROVED_EXIT"].includes(k.disposal_type)) levels.push("FINANCE");
  const threshold = toPaise(settings.disposal_management_threshold ?? 100000);
  if (total >= threshold || k.disposal_type === "DONATION" || k.related_party) levels.push("MANAGEMENT");
  const version = hash({ levels, threshold: String(settings.disposal_management_threshold ?? 100000), selfApproval: settings.prohibit_self_approval !== false });
  return { levels, version, carrying: fromPaise(total), selfApproval: settings.prohibit_self_approval !== false };
}
export async function submitAssetDisposal(client, c, caseId, input = {}) {
  requireDx(c, DX.submit);
  const k = await loadCase(client, c, caseId);
  versionCheck(k, input.expectedVersion);
  if (k.status === "PENDING_APPROVAL") return { caseId: k.id, status: k.status, replayed: true };
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(k.status)) throw dxError(409, "ASSET_DISPOSAL_INVALID", "Only a draft is submitted.");
  const { lines, basis } = await basisOf(client, k);
  if (!lines.length) throw dxError(409, "ASSET_DISPOSAL_ASSET_INVALID", "The case has no assets.");
  for (const l of lines) {
    const a = await findAsset(client, c, { assetId: l.asset_id });
    const e = await eligibilityOf(client, c, a, k.disposal_type, { exceptLineId: l.id });
    if (e.blockers.length) throw dxError(409, e.blockers[0].code, e.blockers[0].message, { assetId: a.id });
  }
  const policy = await policyOf(client, c, k, lines);
  await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'PENDING_APPROVAL', row_version = row_version + 1 WHERE case_id = $1 AND line_status = 'DRAFT'`, [k.id]);
  await client.query(`UPDATE tenant.asset_disposal_cases SET status = 'PENDING_APPROVAL', required_approvals = $2, policy_version = $3, basis_hash = $4, submitted_at = clock_timestamp(), updated_at = clock_timestamp(),
      row_version = row_version + 1 WHERE id = $1`, [k.id, policy.levels, policy.version, basis]);
  await logDisposalEvent(client, c, { caseId: k.id }, "SUBMITTED", { from: k.status, to: "PENDING_APPROVAL", details: { approvals: policy.levels, carrying: policy.carrying } });
  const approvers = [...(await usersWith(client, c, DX.approve)), ...(policy.levels.includes("FINANCE") ? await usersWith(client, c, DX.financeReview) : [])];
  await notify(client, c, approvers.filter((u) => u !== k.requested_by), `${k.case_number}: disposal waiting for approval`, `${lines.length} asset${lines.length === 1 ? "" : "s"} · ${k.disposal_type.toLowerCase().replace(/_/g, " ")}`, k.id);
  return { caseId: k.id, status: "PENDING_APPROVAL", approvals: policy.levels };
}
const approvalsOf = async (client, k) => (await client.query(`SELECT * FROM tenant.asset_disposal_approvals WHERE case_id = $1 AND basis_hash = $2 AND policy_version = $3 ORDER BY approved_at`,
  [k.id, k.basis_hash, k.policy_version])).rows;
// input: { level?: OPERATIONAL | FINANCE | MANAGEMENT, note?, supersedeMaintenance?, expectedVersion? } — once every required approval is in, the
// assets are committed to the disposal (restricted from ordinary use) — approval never disposes of anything by itself.
export async function approveAssetDisposal(client, c, caseId, input = {}) {
  if (!has(c, DX.approve) && !has(c, DX.financeReview)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  versionCheck(k, input.expectedVersion);
  if (k.status !== "PENDING_APPROVAL") throw dxError(409, k.status === "APPROVED" ? "ASSET_DISPOSAL_INVALID" : "ASSET_DISPOSAL_APPROVAL_REQUIRED", "Only a disposal waiting for approval is approved.");
  const { lines, basis } = await basisOf(client, k);
  if (basis !== k.basis_hash) throw dxError(409, "ASSET_DISPOSAL_VERSION_CONFLICT", "The disposal changed after it was submitted; it is submitted again.");
  const policy = await policyOf(client, c, k, lines);
  if (policy.version !== k.policy_version) throw dxError(409, "ASSET_DISPOSAL_VERSION_CONFLICT", "The Company's approval policy changed; the disposal is submitted again.");
  if (policy.selfApproval && k.requested_by === c.userId) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED", "Someone other than the requester approves the disposal.");
  const given = await approvalsOf(client, k);
  if (given.some((g) => g.approver_user_id === c.userId)) throw dxError(409, "ASSET_DISPOSAL_INVALID", "You have already approved this disposal; another approver is needed.");
  const missing = k.required_approvals.filter((lv) => !given.some((g) => g.level === lv));
  const can = (lv) => (lv === "FINANCE" ? has(c, DX.financeReview) : has(c, DX.approve) && (lv === "OPERATIONAL" || given.some((g) => g.level === "OPERATIONAL")));
  const level = input.level ? oneOf(input.level, ["OPERATIONAL", "FINANCE", "MANAGEMENT"], null, "approval") : missing.find(can);
  if (!level || !missing.includes(level)) throw dxError(409, "ASSET_DISPOSAL_INVALID", missing.length ? "Your approval is not the one this disposal needs next." : "Every approval is already in.");
  if (!can(level)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED", level === "MANAGEMENT" ? "Management approves after the asset approval." : undefined);
  // Open maintenance is completed first, or superseded by the disposal on purpose.
  for (const l of lines) {
    const work = await maintenanceOf(client, l.asset_id);
    if (!work.length) continue;
    if (input.supersedeMaintenance !== true) throw dxError(409, "ASSET_DISPOSAL_MAINTENANCE_ACTIVE", `${l.asset_number}: ${work.map((w) => w.work_order_number).join(", ")} is still open. Complete it, or approve with the repair superseded.`);
  }
  await client.query(`INSERT INTO tenant.asset_disposal_approvals (organization_id, case_id, level, approver_user_id, policy_version, basis_hash, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.organizationId, k.id, level, c.userId, k.policy_version, k.basis_hash, text(input.note, 1000) || null]);
  await logDisposalEvent(client, c, { caseId: k.id }, "APPROVED", { details: { level }, reason: text(input.note, 1000) || null });
  const still = missing.filter((lv) => lv !== level);
  if (still.length) return { caseId: k.id, status: "PENDING_APPROVAL", approved: level, waitingFor: still };
  if (input.supersedeMaintenance === true) {
    const { cancelMaintenanceWorkOrder } = await import("../asset-maintenance/mt-commands.js");
    for (const l of lines) for (const w of await maintenanceOf(client, l.asset_id)) {
      await cancelMaintenanceWorkOrder(client, { ...c, permissions: [...(c.permissions ?? []), "assets.maintenance.cancel"] }, w.id, { reason: `Superseded by disposal ${k.case_number}` });
    }
  }
  for (const l of lines) {
    const lost = k.disposal_type === "WRITE_OFF_LOST";
    const incident = lost ? await incidentOf(client, l.asset_id) : null;
    // A confirmed loss is its own evidence: no handover is invented.
    await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = $2, handover_kind = CASE WHEN $3 THEN 'LOSS_EVIDENCE' ELSE handover_kind END, missing_incident_id = COALESCE($4, missing_incident_id),
        actual_disposition_date = CASE WHEN $3 THEN $5::date ELSE actual_disposition_date END, row_version = row_version + 1 WHERE id = $1`,
      [l.id, lost ? "PENDING_FINANCE" : "PENDING_HANDOVER", lost, incident?.id ?? null, lost ? dayOfDb(incident?.decided_at) ?? dayOfDb(k.proposed_effective_date) : null]);
    await recordAssetEvent(client, c, l.asset_id, "asset.disposal_approved", { caseId: k.id });
  }
  await client.query(`UPDATE tenant.asset_disposal_cases SET approved_at = clock_timestamp(), updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [k.id]);
  const status = await refreshCase(client, { ...k, status: "PENDING_APPROVAL" });
  await notify(client, c, [k.requested_by, ...(await usersWith(client, c, DX.handover))], `${k.case_number}: disposal approved`, k.disposal_type === "WRITE_OFF_LOST" ? "Finance can now write it off." : "Record the physical handover when the asset leaves.", k.id);
  return { caseId: k.id, status, approved: level, waitingFor: [] };
}
// input: { decision: REJECT | REQUEST_CHANGES, reason }
export async function rejectAssetDisposal(client, c, caseId, input = {}) {
  if (!has(c, DX.reject)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  if (k.status !== "PENDING_APPROVAL") throw dxError(409, "ASSET_DISPOSAL_INVALID", "Only a disposal waiting for approval is rejected or sent back.");
  const decision = oneOf(input.decision, ["REJECT", "REQUEST_CHANGES"], "REJECT", "decision");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Give the reason.", { field: "reason" });
  const to = decision === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED";
  await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = $2, row_version = row_version + 1 WHERE case_id = $1 AND line_status = 'PENDING_APPROVAL'`, [k.id, decision === "REJECT" ? "REJECTED" : "DRAFT"]);
  await client.query(`UPDATE tenant.asset_disposal_cases SET status = $2, decision_note = $3, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [k.id, to, reason]);
  await logDisposalEvent(client, c, { caseId: k.id }, decision === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED", { from: k.status, to, reason });
  await notify(client, c, [k.requested_by], `${k.case_number}: ${decision === "REJECT" ? "disposal rejected" : "changes requested"}`, reason, k.id);
  return { caseId: k.id, status: to };
}
// input: { proposedEffectiveDate?, buyerPartyId?, recipientName?, recyclerSupplierId?, relatedParty?, lines?: [{ lineId, proposedProceeds?, disposalCosts? }], reason } — a material change after
// submission or approval (before any asset has left): every approval given so far no longer counts; the disposal is approved again.
export async function amendAssetDisposal(client, c, caseId, input = {}) {
  requireDx(c, DX.create);
  const k = await loadCase(client, c, caseId);
  versionCheck(k, input.expectedVersion);
  if (!["PENDING_APPROVAL", "APPROVED", "PENDING_HANDOVER"].includes(k.status)) throw dxError(409, "ASSET_DISPOSAL_INVALID", "This disposal can no longer be amended.");
  const lines = await linesOf(client, k.id, { lock: true });
  if (lines.some((l) => l.handover_at || l.sale_invoice_id || ["PENDING_FINANCE", "POSTING", "COMPLETED"].includes(l.line_status))) throw dxError(409, "ASSET_DISPOSAL_INVALID", "An asset has already left or been invoiced; record a correction instead.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Give the reason for the change.", { field: "reason" });
  const f = await caseFields(client, c, input, { disposalType: k.disposal_type, reasonCode: k.reason_code, explanation: k.explanation, proposedEffectiveDate: dayOfDb(k.proposed_effective_date),
    buyerPartyId: k.buyer_party_id, recyclerSupplierId: k.recycler_supplier_id, recipientName: k.recipient_name, destination: k.destination, relatedParty: k.related_party });
  if (f.type !== k.disposal_type) throw dxError(409, "ASSET_DISPOSAL_INVALID", "A different kind of disposal is a new case.");
  await client.query(`UPDATE tenant.asset_disposal_cases SET proposed_effective_date = $2, buyer_party_id = $3, recycler_supplier_id = $4, recipient_name = $5, destination = $6, related_party = $7 WHERE id = $1`,
    [k.id, f.effective, f.buyer, f.recycler, f.recipient, f.destination, f.relatedParty]);
  for (const x of Array.isArray(input.lines) ? input.lines : []) {
    const l = lines.find((y) => y.id === x.lineId);
    if (!l) throw dxError(400, "ASSET_DISPOSAL_INVALID", "That asset is not in this case.");
    await client.query(`UPDATE tenant.asset_disposal_lines SET proposed_proceeds = $2, disposal_costs = $3, row_version = row_version + 1 WHERE id = $1`,
      [l.id, WITH_PROCEEDS.includes(k.disposal_type) ? amountOf(x.proposedProceeds ?? l.proposed_proceeds, "proposed proceeds") : "0.00", amountOf(x.disposalCosts ?? l.disposal_costs, "disposal costs")]);
  }
  await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'PENDING_APPROVAL', row_version = row_version + 1 WHERE case_id = $1 AND line_status IN ('PENDING_HANDOVER', 'PENDING_APPROVAL')`, [k.id]);
  const fresh = await loadCase(client, c, k.id);
  const { lines: live, basis } = await basisOf(client, fresh);
  const policy = await policyOf(client, c, fresh, live);
  await client.query(`UPDATE tenant.asset_disposal_cases SET status = 'PENDING_APPROVAL', required_approvals = $2, policy_version = $3, basis_hash = $4, approved_at = NULL, updated_at = clock_timestamp(),
      row_version = row_version + 1 WHERE id = $1`, [k.id, policy.levels, policy.version, basis]);
  await logDisposalEvent(client, c, { caseId: k.id }, "AMENDED", { from: k.status, to: "PENDING_APPROVAL", reason, details: { approvals: policy.levels } });
  return { caseId: k.id, status: "PENDING_APPROVAL", approvals: policy.levels, reapprovalRequired: true };
}

// ------------------------------------------------------------------ physical exit
const loadLine = async (client, k, lineId) => {
  const lines = await linesOf(client, k.id, { lock: true });
  const l = lineId ? lines.find((x) => x.id === lineId) : lines.filter((x) => LIVE_LINE.includes(x.line_status) || x.line_status === "COMPLETED").length === 1 ? lines.find((x) => LIVE_LINE.includes(x.line_status) || x.line_status === "COMPLETED") : null;
  if (!l) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Choose the asset in this case.", { field: "lineId" });
  return l;
};
async function custodyResolved(client, k, l) {
  if (k.disposal_type === "WRITE_OFF_LOST") return true;
  const holder = await custodyOf(client, l.asset_id);
  return !holder || !["EMPLOYEE", "DEPARTMENT"].includes(holder.custodian_type) || Boolean(l.custody_exception_reason);
}
// input: { lineId?, identifier, condition, handoverKind, recipient?, reference?, evidence?, dispositionDate?, transferId?, custodyException? } — the asset has left the Company
// (delivered to the buyer, received by the recycler or recipient, destroyed): identity confirmed by scan, custody resolved, no movement in progress.
export async function confirmDisposalHandover(client, c, caseId, input = {}) {
  requireDx(c, DX.handover);
  const k = await loadCase(client, c, caseId);
  const l = await loadLine(client, k, input.lineId);
  const command = text(input.commandId, 200) || null;
  if (await replayed(client, c, command)) return { caseId: k.id, lineId: l.id, status: l.line_status, replayed: true };
  if (l.line_status !== "PENDING_HANDOVER") throw dxError(409, ["DRAFT", "PENDING_APPROVAL"].includes(l.line_status) ? "ASSET_DISPOSAL_APPROVAL_REQUIRED" : "ASSET_DISPOSAL_INVALID",
    ["DRAFT", "PENDING_APPROVAL"].includes(l.line_status) ? undefined : "The handover of this asset is already recorded.");
  const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1 FOR UPDATE`, [l.asset_id])).rows[0];
  const { identifies } = await import("../asset-transfers/tr-commands.js");
  if (!text(input.identifier, 200) || !(await identifies(client, c, a, text(input.identifier, 200)))) throw dxError(409, "ASSET_DISPOSAL_HANDOVER_REQUIRED", `Scan or type ${a.asset_number}'s code, serial or tag to confirm it is the asset leaving.`);
  if (input.custodyException) {
    if (!has(c, DX.approve)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED", "An authorized approver records a custody exception.");
    const why = text(input.custodyException, 1000);
    if (why.length < 5) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Explain the custody exception.", { field: "custodyException" });
    await client.query(`UPDATE tenant.asset_disposal_lines SET custody_exception_reason = $2, custody_exception_by = $3 WHERE id = $1`, [l.id, why, c.userId]);
    l.custody_exception_reason = why;
  }
  if (!(await custodyResolved(client, k, l))) throw dxError(409, "ASSET_DISPOSAL_CUSTODY_UNRESOLVED", `${a.asset_number} is still with ${(await custodyOf(client, a.id)).label}: return it to a store first, or record an authorized exception.`);
  const t = await transferOf(client, a.id);
  if (t && ["DISPATCHED", "RECEIPT_EXCEPTION", "RETURN_IN_PROGRESS", "PENDING", "APPROVED"].includes(t.line_status) && t.reason_code !== "DISPOSAL_MOVEMENT") throw dxError(409, "ASSET_DISPOSAL_TRANSFER_ACTIVE", `Transfer ${t.transfer_number} is still in progress.`);
  if (t && t.reason_code === "DISPOSAL_MOVEMENT" && ["DISPATCHED", "RETURN_IN_PROGRESS", "RECEIPT_EXCEPTION"].includes(t.line_status)) throw dxError(409, "ASSET_DISPOSAL_TRANSFER_ACTIVE", `${t.transfer_number} has not been received yet.`);
  if (k.disposal_type === "SALE" && !k.buyer_party_id) throw dxError(409, "ASSET_SALE_BUYER_INVALID", "Select a valid buyer.");
  if (k.disposal_type === "SALE" && toPaise(l.agreed_price ?? l.proposed_proceeds ?? 0) <= 0n) throw dxError(409, "ASSET_SALE_PRICE_INVALID", "Review the agreed selling price.");
  const kinds = { SALE: ["BUYER_DELIVERY"], SCRAP: ["RECYCLER_RECEIPT", "DESTRUCTION"], DONATION: ["DONATION_RECEIPT"], WRITE_OFF_DAMAGED: ["DESTRUCTION", "RECYCLER_RECEIPT", "OTHER_EXIT"], OTHER_APPROVED_EXIT: ["OTHER_EXIT", "BUYER_DELIVERY", "RECYCLER_RECEIPT", "DESTRUCTION"] }[k.disposal_type];
  const kind = oneOf(input.handoverKind, kinds, kinds[0], "how the asset left");
  const condition = oneOf(input.condition, CONDITIONS, null, "condition at disposal");
  const date = dayOf(input.dispositionDate ?? today(), "date it left", { required: true });
  if (date > today()) throw dxError(400, "ASSET_DISPOSAL_INVALID", "The date it left cannot be in the future.", { field: "dispositionDate" });
  const recipient = text(input.recipient, 200) || k.recipient_name || null;
  if (["DONATION_RECEIPT", "BUYER_DELIVERY", "RECYCLER_RECEIPT"].includes(kind) && !recipient && !k.buyer_party_id && !k.recycler_supplier_id) throw dxError(400, "ASSET_DISPOSAL_HANDOVER_REQUIRED", "Name who received the asset.", { field: "recipient" });
  let transferId = null;
  if (input.transferId) {
    const tr = (await client.query(`SELECT o.id FROM tenant.asset_transfer_orders o JOIN tenant.asset_transfer_lines tl ON tl.transfer_id = o.id AND tl.asset_id = $3 WHERE o.organization_id = $1 AND o.id = $2`,
      [c.organizationId, uuid(input.transferId, "Transfer"), a.id])).rows[0];
    if (!tr) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Choose the transfer that moved this asset.");
    transferId = tr.id;
  }
  await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'PENDING_FINANCE', handover_kind = $2, handover_recipient = $3, handover_reference = $4, handover_evidence = $5, handover_at = clock_timestamp(),
      handover_by = $6, actual_disposition_date = $7, condition_at_disposal = $8, transfer_id = $9, row_version = row_version + 1 WHERE id = $1`,
    [l.id, kind, recipient, text(input.reference, 200) || null, text(input.evidence, 1000) || null, c.userId, date, condition, transferId]);
  if (k.disposal_type === "SCRAP" && !l.scrap_method) {
    const inferred = kind === "RECYCLER_RECEIPT" ? "RECYCLER_COLLECTION" : kind === "DESTRUCTION" ? "SUPERVISED_DESTRUCTION" : null;
    const flagged = (await client.query(`SELECT scrap_evidence_required FROM tenant.asset_categories WHERE id = $1`, [a.category_id])).rows[0]?.scrap_evidence_required === true;
    await client.query(`UPDATE tenant.asset_disposal_lines SET scrap_method = COALESCE($2, scrap_method), certificate_required = certificate_required OR $3 WHERE id = $1`, [l.id, inferred, flagged]);
  }
  await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: a.id }, "HANDOVER_CONFIRMED", { from: l.line_status, to: "PENDING_FINANCE", details: { kind, recipient, date, condition }, commandId: command });
  await recordAssetEvent(client, c, a.id, "asset.disposal_handover", { caseId: k.id, kind, date });
  const status = await refreshCase(client, k);
  // Nothing financial to wait for (tracked-only, no proceeds): the asset's exit completes it.
  let completed = false;
  if (a.capitalization_class === "TRACKED_ONLY" && toPaise(l.proposed_proceeds) === 0n) {
    const fresh = (await linesOf(client, k.id)).find((x) => x.id === l.id);
    await client.query("SAVEPOINT dx_auto_complete");
    try { await completeLine(client, c, k, fresh); completed = true; await client.query("RELEASE SAVEPOINT dx_auto_complete"); }
    catch (error) { await client.query("ROLLBACK TO SAVEPOINT dx_auto_complete"); if (!error.code) throw error; }
  }
  return { caseId: k.id, lineId: l.id, status: completed ? "COMPLETED" : "PENDING_FINANCE", caseStatus: completed ? await refreshCase(client, await loadCase(client, c, k.id)) : status };
}

// ------------------------------------------------------------------ the sale invoice (Sales is authoritative)
const invoiceNet = (i) => toPaise(i.subtotal) - toPaise(i.discount_total ?? 0) + toPaise(i.charge_total ?? 0);
// input: { lineId?, invoice (number or id), amount? } — the Sales Invoice that recognizes this asset's sale: posted, to the case's buyer. Its pre-tax amount is
// the proceeds (output GST is never proceeds); several assets may share one invoice, never more than its amount.
export async function linkDisposalSaleInvoice(client, c, caseId, input = {}) {
  if (!has(c, DX.create) && !has(c, DX.financeReview) && !has(c, "assets.disposal.manage_sale")) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  if (!WITH_PROCEEDS.includes(k.disposal_type)) throw dxError(409, "ASSET_DISPOSAL_INVALID", "Only a sale or a scrap sale has an invoice.");
  const l = await loadLine(client, k, input.lineId);
  if (!EXECUTING.includes(l.line_status) || l.line_status === "POSTING") throw dxError(409, l.line_status === "PENDING_APPROVAL" ? "ASSET_DISPOSAL_APPROVAL_REQUIRED" : "ASSET_DISPOSAL_INVALID", l.line_status === "PENDING_APPROVAL" ? undefined : "This asset's sale can no longer be linked.");
  if ((await client.query(`SELECT 1 FROM tenant.asset_disposal_accounting_intents WHERE line_id = $1 AND status IN ('POSTING', 'POSTED')`, [l.id])).rows[0]) throw dxError(409, "ASSET_DISPOSAL_ALREADY_POSTED");
  const ref = text(input.invoice, 100);
  const inv = (await client.query(`SELECT * FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND (invoice_number = $2 OR id::text = $2)`, [c.organizationId, ref])).rows[0];
  if (!inv) throw dxError(400, "ASSET_DISPOSAL_SALE_INVOICE_REQUIRED", "No such Sales Invoice.");
  if (!LIVE_BILL.includes(String(inv.status))) throw dxError(409, "ASSET_DISPOSAL_SALE_INVOICE_REQUIRED", `${inv.invoice_number} is ${String(inv.status).replace(/_/g, " ")}; link it once it is posted.`);
  if (k.buyer_party_id && inv.party_id !== k.buyer_party_id) throw dxError(409, "ASSET_DISPOSAL_SALE_INVOICE_REQUIRED", `${inv.invoice_number} is to another customer than this disposal's buyer.`);
  if (inv.invoice_type && inv.invoice_type !== "invoice") throw dxError(409, "ASSET_DISPOSAL_SALE_INVOICE_REQUIRED", "Link the sale's invoice, not a credit or debit note.");
  if (l.sale_invoice_id && l.sale_invoice_id !== inv.id) throw dxError(409, "ASSET_SALE_INVOICE_DUPLICATE", `${l.asset_number} is already linked to ${l.sale_invoice_number}.`);
  const net = invoiceNet(inv);
  const others = (await client.query(`SELECT COALESCE(sum(sale_proceeds), 0)::text AS t FROM tenant.asset_disposal_lines WHERE sale_invoice_id = $1 AND id <> $2 AND line_status NOT IN ('CANCELLED', 'REJECTED', 'REINSTATED')`, [inv.id, l.id])).rows[0].t;
  const available = net - toPaise(others);
  const amount = input.amount !== undefined && input.amount !== null && input.amount !== "" ? toPaise(amountOf(input.amount, "amount")) : available;
  if (amount <= 0n || amount > available) throw dxError(409, "ASSET_DISPOSAL_RECONCILIATION_FAILED", `${inv.invoice_number} has ${fromPaise(available)} not yet allocated to other assets; one receivable is never recognized twice.`);
  await client.query(`UPDATE tenant.asset_disposal_lines SET sale_invoice_id = $2, sale_invoice_number = $3, sale_proceeds = $4, row_version = row_version + 1 WHERE id = $1`, [l.id, inv.id, inv.invoice_number, fromPaise(amount)]);
  await client.query(`UPDATE tenant.asset_disposal_proceeds_allocations SET status = 'SUPERSEDED', superseded_at = clock_timestamp() WHERE line_id = $1 AND status = 'ACTIVE'`, [l.id]);
  await client.query(`INSERT INTO tenant.asset_disposal_proceeds_allocations (organization_id, case_id, line_id, invoice_id, amount, basis, allocated_by) VALUES ($1,$2,$3,$4,$5,'MANUAL',$6)`,
    [c.organizationId, k.id, l.id, inv.id, fromPaise(amount), c.userId]);
  if (!k.buyer_party_id) await client.query(`UPDATE tenant.asset_disposal_cases SET buyer_party_id = $2 WHERE id = $1`, [k.id, inv.party_id]);
  await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "SALE_INVOICE_LINKED", { details: { invoice: inv.invoice_number, proceeds: fromPaise(amount), tax: String(inv.tax_total) } });
  return { caseId: k.id, lineId: l.id, invoice: inv.invoice_number, proceeds: fromPaise(amount), outputTax: fromPaise(toPaise(inv.tax_total ?? 0)) };
}
export async function unlinkDisposalSaleInvoice(client, c, caseId, input = {}) {
  if (!has(c, DX.create) && !has(c, DX.financeReview)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  const l = await loadLine(client, k, input.lineId);
  if (!l.sale_invoice_id) throw dxError(409, "ASSET_DISPOSAL_INVALID", "No invoice is linked.");
  if (l.line_status === "COMPLETED" || (await client.query(`SELECT 1 FROM tenant.asset_disposal_accounting_intents WHERE line_id = $1 AND status IN ('POSTING', 'POSTED')`, [l.id])).rows[0]) throw dxError(409, "ASSET_DISPOSAL_ALREADY_POSTED");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Give the reason (for example the credit note).", { field: "reason" });
  const inv = (await client.query(`SELECT status FROM tenant.accounting_customer_invoices WHERE id = $1`, [l.sale_invoice_id])).rows[0];
  const credited = (await client.query(`SELECT 1 FROM tenant.accounting_customer_invoices WHERE source_invoice_id = $1 AND invoice_type = 'credit_note' AND status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')`, [l.sale_invoice_id])).rows[0];
  if (inv && LIVE_BILL.includes(String(inv.status)) && !credited) throw dxError(409, "ASSET_DISPOSAL_INVALID", `${l.sale_invoice_number} is posted: Sales credits or reverses it before it is unlinked.`);
  await client.query(`UPDATE tenant.asset_disposal_lines SET sale_invoice_id = NULL, sale_invoice_number = NULL, sale_proceeds = NULL, sale_invoice_line_id = NULL, row_version = row_version + 1 WHERE id = $1`, [l.id]);
  await client.query(`UPDATE tenant.asset_disposal_proceeds_allocations SET status = 'SUPERSEDED', superseded_at = clock_timestamp() WHERE line_id = $1 AND status = 'ACTIVE'`, [l.id]);
  await withdrawIntent(client, l.id, "Sale invoice unlinked");
  await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "SALE_INVOICE_UNLINKED", { details: { invoice: l.sale_invoice_number }, reason });
  return { caseId: k.id, lineId: l.id };
}

// ------------------------------------------------------------------ Finance: carrying value and derecognition
async function accountsFor(client, a) {
  const cat = (await client.query(`SELECT * FROM tenant.asset_categories WHERE id = $1`, [a.category_id])).rows[0] ?? {};
  const basis = (await client.query(`SELECT accumulated_account_id FROM tenant.asset_depreciation_bases WHERE asset_id = $1 AND status = 'APPROVED' ORDER BY approved_at DESC NULLS LAST LIMIT 1`, [a.id]).catch(() => ({ rows: [] }))).rows[0];
  return { asset: cat.asset_account_id ?? null, accumulated: basis?.accumulated_account_id ?? cat.accumulated_depreciation_account_id ?? null, proceeds: cat.proceeds_account_id ?? null, gainLoss: cat.gain_loss_account_id ?? null,
    loss: cat.disposal_loss_account_id ?? null };
}
async function accountsUsable(client, c, ids) {
  const wanted = ids.filter(Boolean);
  if (!wanted.length) return true;
  const n = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [c.organizationId, wanted]).catch(() => ({ rows: [{ n: wanted.length }] }))).rows[0].n);
  return n === new Set(wanted).size;
}
const effectiveOf = (k, l) => dayOfDb(l.actual_disposition_date) ?? dayOfDb(k.proposed_effective_date);
// The disposal's financial picture for one asset at its derecognition date — computed from the asset's Finance-confirmed figures, never
// edited; with every check that stands between it and posting.
export async function financialPictureOf(client, c, k, l) {
  const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1`, [l.asset_id])).rows[0];
  const effective = effectiveOf(k, l);
  const tracked = a.capitalization_class === "TRACKED_ONLY";
  const share = WITH_PROCEEDS.includes(k.disposal_type) ? (l.sale_proceeds !== null && l.sale_proceeds !== undefined ? toPaise(l.sale_proceeds) : toPaise(l.agreed_price ?? l.proposed_proceeds ?? 0)) : 0n;
  const consideration = await considerationOf(client, l, share);
  const proceeds = consideration.proceeds;
  const costed = await costsOf(client, l);
  const costs = costed.net;
  const extra = { grossConsideration: fromPaise(consideration.gross), tax: fromPaise(consideration.tax), currency: consideration.currency, rate: consideration.rate, foreign: consideration.foreign,
    costsEstimated: costed.estimated, separateCosts: fromPaise(costed.separate), costEstimate: fromPaise(costed.estimate), otherAdjustments: "0.00",
    insurance: l.insurance_claim_reference ? { reference: l.insurance_claim_reference, expected: l.insurance_expected_amount !== null && l.insurance_expected_amount !== undefined ? fromPaise(toPaise(l.insurance_expected_amount)) : null } : null };
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  const needsInvoice = WITH_PROCEEDS.includes(k.disposal_type) && toPaise(l.agreed_price ?? l.proposed_proceeds ?? 0) > 0n;
  if (needsInvoice && !l.sale_invoice_id) add("ASSET_DISPOSAL_SALE_INVOICE_REQUIRED", "Link the posted Sales Invoice of the sale.");
  if (l.sale_invoice_id) {
    const inv = (await client.query(`SELECT status, invoice_number FROM tenant.accounting_customer_invoices WHERE id = $1`, [l.sale_invoice_id])).rows[0];
    if (!inv || ["cancelled", "reversed"].includes(String(inv.status))) add("ASSET_DISPOSAL_RECONCILIATION_FAILED", `${l.sale_invoice_number} is no longer valid (${inv?.status ?? "missing"}).`);
  }
  for (const x of await executionIssuesOf(client, k, l)) add(x.code, x.message);
  if (!["PENDING_FINANCE", "POSTING", "RECOVERY_REQUIRED", "COMPLETED"].includes(l.line_status)) add("ASSET_DISPOSAL_HANDOVER_REQUIRED", "The asset's physical exit is not yet confirmed.");
  if (tracked) return { assetId: a.id, tracked: true, effective, cost: null, accumulated: null, impairment: null, carrying: null, proceeds: fromPaise(proceeds), costs: fromPaise(costs), gainLoss: null,
    accounts: null, pendingDepreciation: [], issues, ready: !issues.length, ...extra, note: "Tracked only: no fixed-asset balance is derecognized; any sale goes through Sales and Finance." };
  if (a.capitalization_class !== "CAPITALIZED") add("ASSET_DISPOSAL_CARRYING_VALUE_UNCONFIRMED", "Finance has not confirmed the asset's cost.");
  let pending = [];
  try {
    const { assertDepreciationSettled } = await import("../asset-depreciation/dp-commands.js");
    await assertDepreciationSettled(client, c, a, effective);
  } catch (error) {
    if (error.code !== "ASSET_DEPRECIATION_PENDING") throw error;
    pending = error.details?.periods ?? [];
    add("ASSET_DISPOSAL_FINAL_DEPRECIATION_PENDING", `Post the depreciation of ${pending.join(", ")} first (through the disposal date).`);
  }
  const cost = toPaise(a.capitalized_cost ?? 0); const acc = toPaise(a.accumulated_depreciation ?? 0); const imp = toPaise(a.impairment_accumulated ?? 0);
  const carrying = cost - acc - imp;
  const gain = proceeds - costs - carrying;
  const accounts = await accountsFor(client, a);
  const net = proceeds - costs;
  const resultAccount = gain > 0n ? accounts.gainLoss : gain < 0n ? accounts.loss ?? accounts.gainLoss : "x";
  const needed = [accounts.asset, acc + imp > 0n ? accounts.accumulated : "x", net !== 0n ? accounts.proceeds : "x", resultAccount];
  if (needed.some((x) => !x) || !(await accountsUsable(client, c, needed.filter((x) => x && x !== "x")))) add("ASSET_DISPOSAL_GL_MAPPING_MISSING", `Set the ${[!accounts.asset && "fixed-asset", acc + imp > 0n && !accounts.accumulated && "accumulated depreciation", net !== 0n && !accounts.proceeds && "disposal proceeds", !resultAccount && (gain > 0n ? "gain on disposal" : "loss on disposal")].filter(Boolean).join(", ") || "active"} accounts on the category.`);
  const basisSource = await basisSourceOf(client, a.id);
  return { assetId: a.id, tracked: false, effective, cost: fromPaise(cost), accumulated: fromPaise(acc), impairment: fromPaise(imp), carrying: fromPaise(carrying), residual: a.residual_value !== null && a.residual_value !== undefined ? fromPaise(toPaise(a.residual_value)) : null,
    proceeds: fromPaise(proceeds), costs: fromPaise(costs), gainLoss: fromPaise(gain), outcome: gain > 0n ? "GAIN" : gain < 0n ? "LOSS" : "ZERO", accounts, pendingDepreciation: pending, issues, ready: !issues.length, basisSource, ...extra,
    basis: hash({ cost: String(cost), acc: String(acc), imp: String(imp), proceeds: String(proceeds), costs: String(costs), separate: String(costed.separate), estimated: costed.estimated, rate: consideration.rate, effective, accounts }) };
}
async function withdrawIntent(client, lineId, why) {
  await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'WITHDRAWN', result = $2 WHERE line_id = $1 AND status = 'PREPARED'`, [lineId, why]);
}
const liveIntent = async (client, lineId) => (await client.query(`SELECT * FROM tenant.asset_disposal_accounting_intents WHERE line_id = $1 AND status IN ('PREPARED', 'POSTING', 'POSTED', 'NOT_REQUIRED', 'RECOVERY_REQUIRED') ORDER BY created_at DESC LIMIT 1`, [lineId])).rows[0] ?? null;
// input: { lineId? } — Finance confirms the carrying value at the derecognition date: a snapshot is kept, and one derecognition intent per asset and book.
export async function prepareAssetDerecognition(client, c, caseId, input = {}) {
  if (!has(c, DX.financeReview) && !has(c, DX.derecognize)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  const l = await loadLine(client, k, input.lineId);
  if (l.line_status !== "PENDING_FINANCE") throw dxError(409, ["PENDING_HANDOVER"].includes(l.line_status) ? "ASSET_DISPOSAL_HANDOVER_REQUIRED" : l.line_status === "POSTING" ? "ASSET_DISPOSAL_OUTCOME_UNKNOWN" : "ASSET_DISPOSAL_INVALID");
  const existing = await liveIntent(client, l.id);
  if (existing && ["POSTED", "NOT_REQUIRED"].includes(existing.status)) throw dxError(409, "ASSET_DISPOSAL_ALREADY_POSTED");
  if (existing && ["POSTING", "RECOVERY_REQUIRED"].includes(existing.status)) throw dxError(409, "ASSET_DISPOSAL_OUTCOME_UNKNOWN");
  const p = await financialPictureOf(client, c, k, l);
  if (!p.ready) throw dxError(409, p.issues[0].code, p.issues[0].message, { issues: p.issues });
  if (p.tracked) return { caseId: k.id, lineId: l.id, tracked: true, note: p.note };
  if (p.costsEstimated) throw dxError(409, "DISPOSAL_COSTS_UNRECONCILED", `The disposal costs (${p.costEstimate}) are an estimate: link their supplier bills, or remove the estimate, before Finance approves the result.`);
  if (existing?.status === "PREPARED" && existing.basis_hash === p.basis) return { caseId: k.id, lineId: l.id, intentId: existing.id, replayed: true, ...p };
  if (existing) await withdrawIntent(client, l.id, "Prepared again");
  const snap = await insertSnapshot(client, c, l, p, "APPROVED");
  const intent = (await client.query(`INSERT INTO tenant.asset_disposal_accounting_intents (organization_id, line_id, asset_id, snapshot_id, command_id, basis_hash, posting_date, prepared_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [c.organizationId, l.id, l.asset_id, snap.id, `derecognize:${l.id}:${snap.id}`, p.basis, p.effective, c.userId])).rows[0];
  await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "DERECOGNITION_PREPARED", { details: { carrying: p.carrying, proceeds: p.proceeds, gainLoss: p.gainLoss, effective: p.effective } });
  return { caseId: k.id, lineId: l.id, intentId: intent.id, snapshotId: snap.id, version: snap.version, ...p };
}
async function periodOpen(client, c, day) {
  if (!(await accountingAvailable(client, c))) return;
  const fp = (await client.query(`SELECT id, status, name FROM tenant.fiscal_periods WHERE organization_id = $1 AND start_date <= $2 AND end_date >= $2 ORDER BY (status = 'open') DESC, start_date DESC LIMIT 1`, [c.organizationId, day])).rows[0];
  if (!fp || fp.status !== "open") throw dxError(409, "ASSET_DISPOSAL_PERIOD_CLOSED", fp ? `The accounting period ${fp.name} is ${String(fp.status).replace(/_/g, " ")}; Finance's correction rules apply.` : "No open accounting period covers the disposal date.");
}
const journalFor = async (client, c, lineId) => (await client.query(`SELECT id FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND source_type = 'asset_disposal_line' AND source_id = $2 ORDER BY created_at LIMIT 1`,
  [c.organizationId, lineId])).rows[0]?.id ?? null;
// input: { lineId?, commandId? } — the derecognition journal, through Finance, exactly once: Finance's own journal-posting right is needed; a repeat returns the
// posted result; an unknown outcome is verified, never posted again. When the journal is in, the asset's disposal completes.
export async function postAssetDerecognition(client, c, caseId, input = {}) {
  requireDx(c, DX.derecognize);
  if (!has(c, FINANCE_POST)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED", "Derecognition is posted by Finance: it needs Finance's journal-posting right as well.");
  const k = await loadCase(client, c, caseId);
  const l = await loadLine(client, k, input.lineId);
  const intent = await liveIntent(client, l.id);
  if (intent?.status === "POSTED") return { caseId: k.id, lineId: l.id, status: l.line_status, journalEntryId: intent.journal_entry_id, replayed: true };
  if (intent && ["POSTING", "RECOVERY_REQUIRED"].includes(intent.status)) throw dxError(409, "ASSET_DISPOSAL_OUTCOME_UNKNOWN");
  if (!intent || intent.status !== "PREPARED") throw dxError(409, "ASSET_DISPOSAL_CARRYING_VALUE_UNCONFIRMED", "Finance confirms the carrying value first (prepare the derecognition).");
  const p = await financialPictureOf(client, c, k, l);
  if (!p.ready) throw dxError(409, p.issues[0].code, p.issues[0].message, { issues: p.issues });
  if (p.basis !== intent.basis_hash) { await withdrawIntent(client, l.id, "The basis changed"); throw dxError(409, "DISPOSAL_GAIN_LOSS_STALE", "The carrying value, proceeds or costs changed since Finance approved the result; approve the recalculated result."); }
  // The approver and the poster are two people when the Company separates duties.
  const approver = (await client.query(`SELECT confirmed_by FROM tenant.asset_disposal_financial_snapshots WHERE id = $1`, [intent.snapshot_id])).rows[0]?.confirmed_by;
  if ((await loadSettings(client, c)).prohibit_self_approval !== false && approver && approver === c.userId) throw dxError(403, "DISPOSAL_FINANCIAL_ACCESS_DENIED", "Someone other than the approver of the result posts it.");
  await periodOpen(client, c, p.effective);
  const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1 FOR UPDATE`, [l.asset_id])).rows[0];
  const other = (await client.query(`SELECT 1 FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND source_type = 'asset_disposal' AND source_id IN (SELECT id FROM tenant.asset_disposals WHERE asset_id = $2 AND status = 'completed')`,
    [c.organizationId, a.id]).catch(() => ({ rows: [] }))).rows[0];
  if (other) throw dxError(409, "ASSET_DISPOSAL_ALREADY_POSTED", "This asset was already derecognized by an earlier disposal.");
  const existing = await journalFor(client, c, l.id);
  if (existing) return finishPosting(client, c, k, l, intent, existing, "RECOVERED");
  await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'POSTING', posted_by = $2 WHERE id = $1`, [intent.id, c.userId]);
  await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'POSTING', row_version = row_version + 1 WHERE id = $1`, [l.id]);
  const lines = journalLinesOf(p, { ...l, asset_number: a.asset_number }, k);
  assertBalanced(lines);
  let posted;
  await client.query("SAVEPOINT dx_post");
  try {
    posted = await postAssetJournal(client, c, { date: p.effective, reference: k.case_number, description: `Disposal ${k.case_number} of ${a.asset_number}`, sourceType: "asset_disposal_line", sourceId: l.id,
      sourceNumber: `${k.case_number}/${l.line_number}`, lines });
    await client.query("RELEASE SAVEPOINT dx_post");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT dx_post");
    await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'PREPARED', result = $2 WHERE id = $1`, [intent.id, String(error.message).slice(0, 500)]);
    await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'PENDING_FINANCE', row_version = row_version + 1 WHERE id = $1`, [l.id]);
    await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "POSTING_REJECTED", { details: { message: String(error.message).slice(0, 500) } });
    throw dxError(409, /period/i.test(String(error.message)) ? "ASSET_DISPOSAL_PERIOD_CLOSED" : "ASSET_DISPOSAL_INVALID", `Finance did not accept the journal: ${error.message}`);
  }
  if (posted.status !== "posted") {
    await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'PREPARED', result = 'Finance not configured' WHERE id = $1`, [intent.id]);
    await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'PENDING_FINANCE', row_version = row_version + 1 WHERE id = $1`, [l.id]);
    throw dxError(409, "ASSET_DISPOSAL_GL_MAPPING_MISSING", "Finance's asset journal or the disposal accounts are not set up; nothing was posted.");
  }
  return finishPosting(client, c, k, l, intent, posted.journalEntryId, "POSTED", text(input.commandId, 200) || null);
}
async function finishPosting(client, c, k, l, intent, journalId, outcome, commandId = null) {
  await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'POSTED', journal_entry_id = $2, result = $3, posted_by = COALESCE(posted_by, $4) WHERE id = $1`, [intent.id, journalId, outcome, c.userId]);
  await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'PENDING_FINANCE', row_version = row_version + 1 WHERE id = $1 AND line_status IN ('POSTING', 'RECOVERY_REQUIRED')`, [l.id]);
  await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, outcome === "RECOVERED" ? "POSTING_RECOVERED" : "DERECOGNITION_POSTED", { details: { journalEntryId: journalId }, commandId });
  // The asset's status follows the confirmed posting; if completion cannot finish now, the reconciliation queue shows it — the journal is never posted again.
  const fresh = (await linesOf(client, k.id)).find((x) => x.id === l.id);
  let completion = null;
  await client.query("SAVEPOINT dx_complete");
  try { completion = await completeLine(client, c, k, fresh); await client.query("RELEASE SAVEPOINT dx_complete"); }
  catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT dx_complete");
    await raiseException(client, c, k, fresh, "POSTED_NOT_COMPLETED", `Derecognition is posted but the disposal did not complete: ${error.message}`, "ASSETS");
  }
  return { caseId: k.id, lineId: l.id, journalEntryId: journalId, outcome, status: completion ? "COMPLETED" : "PENDING_FINANCE", caseStatus: await refreshCase(client, await loadCase(client, c, k.id)) };
}
// input: { lineId? } — an interrupted posting: Finance's journal is looked up by its source. Found, the disposal is completed from it; not found, the intent returns to
// prepared and can be posted. A posted derecognition whose asset was not updated is repaired from the posting.
export async function recoverAssetDisposal(client, c, caseId, input = {}) {
  if (!has(c, DX.derecognize) && !has(c, DX.reconcile)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  const l = await loadLine(client, k, input.lineId);
  const intent = await liveIntent(client, l.id);
  if (l.line_status === "COMPLETED") return { caseId: k.id, lineId: l.id, status: "COMPLETED", replayed: true };
  if (intent?.status === "POSTED" || intent?.status === "NOT_REQUIRED") {
    const done = await completeLine(client, c, k, l);
    await resolveExceptions(client, c, l.id, ["POSTED_NOT_COMPLETED"], "Completed from the confirmed posting");
    return { caseId: k.id, lineId: l.id, status: done ? "COMPLETED" : l.line_status, repaired: true };
  }
  if (!intent || !["POSTING", "RECOVERY_REQUIRED"].includes(intent.status)) throw dxError(409, "ASSET_DISPOSAL_INVALID", "Nothing to recover.");
  const journal = await journalFor(client, c, l.id);
  if (journal) return finishPosting(client, c, k, l, intent, journal, "RECOVERED");
  await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'PREPARED', result = 'No journal found on recovery' WHERE id = $1`, [intent.id]);
  await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'PENDING_FINANCE', row_version = row_version + 1 WHERE id = $1`, [l.id]);
  await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "POSTING_NOT_FOUND", {});
  return { caseId: k.id, lineId: l.id, status: "PENDING_FINANCE", journalEntryId: null };
}

// ------------------------------------------------------------------ completion
// One asset's disposal completes only when its exit, its sale, its final depreciation and (capitalized) Finance's posted derecognition all
// agree: then — and only then — the asset is Disposed, its custody ends (history kept), and no depreciation follows.
async function completeLine(client, c, k, l) {
  if (l.line_status === "COMPLETED") return l;
  const p = await financialPictureOf(client, c, k, l);
  if (p.issues.length) throw dxError(409, p.issues[0].code, p.issues[0].message, { issues: p.issues });
  const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1 FOR UPDATE`, [l.asset_id])).rows[0];
  if (a.lifecycle_status === "DISPOSED") throw dxError(409, "ASSET_DISPOSAL_ALREADY_COMPLETED");
  if (!(await custodyResolved(client, k, l))) throw dxError(409, "ASSET_DISPOSAL_CUSTODY_UNRESOLVED");
  const t = await transferOf(client, a.id);
  if (t && ["DISPATCHED", "RECEIPT_EXCEPTION", "RETURN_IN_PROGRESS"].includes(t.line_status)) throw dxError(409, "ASSET_DISPOSAL_TRANSFER_ACTIVE", `Transfer ${t.transfer_number} has not been received yet.`);
  let intent = await liveIntent(client, l.id);
  if (p.tracked) {
    if (!intent) intent = (await client.query(`INSERT INTO tenant.asset_disposal_accounting_intents (organization_id, line_id, asset_id, command_id, basis_hash, posting_date, status, result, prepared_by)
        VALUES ($1,$2,$3,$4,'tracked-only',$5,'NOT_REQUIRED','Tracked only: no fixed-asset balance',$6) RETURNING *`, [c.organizationId, l.id, l.asset_id, `derecognize:${l.id}:none`, p.effective, c.userId])).rows[0];
  } else if (intent?.status !== "POSTED") {
    throw dxError(409, intent && ["POSTING", "RECOVERY_REQUIRED"].includes(intent.status) ? "ASSET_DISPOSAL_OUTCOME_UNKNOWN" : "ASSET_DISPOSAL_DERECOGNITION_PENDING");
  }
  const { withStatusContext } = await import("../asset-status/status-commands.js");
  await withStatusContext(client, c, { action: "DISPOSE", reason: `Disposal ${k.case_number}`, effective: p.effective, sourceType: "ASSET_DISPOSAL", sourceId: l.id }, async () => {
    await client.query(`UPDATE tenant.assets SET lifecycle_status = 'DISPOSED', disposed_at = $2, current_user_id = NULL, current_department_id = NULL, current_store_location_id = NULL,
        net_book_value = CASE WHEN capitalization_class = 'TRACKED_ONLY' THEN net_book_value ELSE 0 END, condition = COALESCE($3, condition) WHERE id = $1`, [a.id, p.effective, l.condition_at_disposal]);
  });
  const { onAssetDisposed } = await import("../asset-depreciation/dp-commands.js");
  await onAssetDisposed(client, c, a.id, p.effective);
  await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'COMPLETED', completed_at = clock_timestamp(), completed_by = $2, row_version = row_version + 1 WHERE id = $1`, [l.id, c.userId]);
  await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: a.id }, "COMPLETED", { from: l.line_status, to: "COMPLETED", details: { effective: p.effective, gainLoss: p.gainLoss, tracked: p.tracked } });
  await recordAssetEvent(client, c, a.id, "asset.disposed", { caseId: k.id, lineId: l.id, type: k.disposal_type, effective: p.effective, gainLoss: p.gainLoss, journalEntryId: intent?.journal_entry_id ?? null });
  return { ...l, line_status: "COMPLETED" };
}
// input: { lineId? } — completes the assets whose every check is satisfied; the others stay pending, each with its reason.
export async function completeAssetDisposal(client, c, caseId, input = {}) {
  requireDx(c, DX.complete);
  const k = await loadCase(client, c, caseId);
  const lines = input.lineId ? [await loadLine(client, k, input.lineId)] : (await linesOf(client, k.id, { lock: true })).filter((l) => EXECUTING.includes(l.line_status));
  if (!lines.length) throw dxError(409, k.status === "COMPLETED" ? "ASSET_DISPOSAL_ALREADY_COMPLETED" : "ASSET_DISPOSAL_APPROVAL_REQUIRED");
  const results = [];
  for (const l of lines) {
    if (l.line_status === "COMPLETED") { results.push({ lineId: l.id, asset: l.asset_number, status: "COMPLETED", replayed: true }); continue; }
    if (l.line_status === "PENDING_HANDOVER") { results.push({ lineId: l.id, asset: l.asset_number, status: l.line_status, code: "ASSET_DISPOSAL_HANDOVER_REQUIRED", message: "The asset has not left yet." }); continue; }
    await client.query("SAVEPOINT dx_line");
    try { await completeLine(client, c, k, l); await client.query("RELEASE SAVEPOINT dx_line"); results.push({ lineId: l.id, asset: l.asset_number, status: "COMPLETED" }); }
    catch (error) { await client.query("ROLLBACK TO SAVEPOINT dx_line"); if (!error.code) throw error; results.push({ lineId: l.id, asset: l.asset_number, status: l.line_status, code: error.code, message: error.message }); }
  }
  const status = await refreshCase(client, await loadCase(client, c, k.id));
  if (input.lineId && results[0].code) throw dxError(409, results[0].code, results[0].message);
  if (status === "COMPLETED") await notify(client, c, [k.requested_by], `${k.case_number}: disposal completed`, `${results.filter((r) => r.status === "COMPLETED").length} asset(s) disposed`, k.id);
  return { caseId: k.id, status, completed: results.filter((r) => r.status === "COMPLETED").length, pending: results.filter((r) => r.code).length, results };
}

// ------------------------------------------------------------------ cancellation and correction
// input: { reason, lineId? } — before any asset has left or been invoiced or posted: the request stays on record, restrictions end. After a handover, record a
// return (correction) instead: the handover is never pretended away.
export async function cancelAssetDisposal(client, c, caseId, input = {}) {
  requireDx(c, DX.cancel);
  const k = await loadCase(client, c, caseId);
  if (k.status === "CANCELLED") return { caseId: k.id, status: "CANCELLED", replayed: true };
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Give the reason.", { field: "reason" });
  const all = await linesOf(client, k.id, { lock: true });
  const lines = input.lineId ? [await loadLine(client, k, input.lineId)] : all.filter((l) => LIVE_LINE.includes(l.line_status));
  for (const l of lines) {
    if (!LIVE_LINE.includes(l.line_status)) throw dxError(409, "ASSET_DISPOSAL_INVALID", `${l.asset_number} is already ${l.line_status.toLowerCase()}.`);
    if (l.handover_at && l.handover_kind !== "LOSS_EVIDENCE") throw dxError(409, "ASSET_DISPOSAL_INVALID", `${l.asset_number} has already left the Company; record its return as a correction instead.`);
    if (l.sale_invoice_id) throw dxError(409, "ASSET_DISPOSAL_INVALID", `${l.asset_number} is invoiced (${l.sale_invoice_number}); Sales credits the invoice and unlinks it first.`);
    const i = await liveIntent(client, l.id);
    if (i && ["POSTING", "POSTED", "RECOVERY_REQUIRED"].includes(i.status)) throw dxError(409, "ASSET_DISPOSAL_ALREADY_POSTED");
  }
  for (const l of lines) {
    await withdrawIntent(client, l.id, "Disposal cancelled");
    await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'CANCELLED', row_version = row_version + 1 WHERE id = $1`, [l.id]);
    await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "LINE_CANCELLED", { from: l.line_status, to: "CANCELLED", reason });
  }
  if (!input.lineId) await client.query(`UPDATE tenant.asset_disposal_cases SET cancel_reason = $2 WHERE id = $1`, [k.id, reason]);
  const status = await refreshCase(client, await loadCase(client, c, k.id));
  await logDisposalEvent(client, c, { caseId: k.id }, input.lineId ? "LINE_CANCELLED" : "CANCELLED", { from: k.status, to: status, reason });
  return { caseId: k.id, status, cancelled: lines.length };
}
// input: { lineId, kind: RETURNED_BEFORE_COMPLETION | REVERSE_AND_REINSTATE, reason, evidence? } — a controlled correction: a buyer's return before completion
// (the handover stays on record), or Finance's reversal of a posted derecognition with the asset reinstated (same code and identity, as Retired: it
// returns to use only by an authorized status change, and Finance reviews its depreciation).
export async function correctAssetDisposal(client, c, caseId, input = {}) {
  requireDx(c, DX.correct);
  const k = await loadCase(client, c, caseId);
  const l = await loadLine(client, k, input.lineId);
  const kind = oneOf(input.kind, ["RETURNED_BEFORE_COMPLETION", "REVERSE_AND_REINSTATE", "RETURNED_AFTER_SALE"], null, "correction");
  const reason = text(input.reason, 1000);
  if (reason.length < 5) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Explain the correction.", { field: "reason" });
  if (kind === "RETURNED_BEFORE_COMPLETION") {
    if (!l.handover_at || l.line_status !== "PENDING_FINANCE") throw dxError(409, "ASSET_DISPOSAL_INVALID", "Only an asset handed over and not yet disposed of is returned this way.");
    if (l.sale_invoice_id) throw dxError(409, "ASSET_DISPOSAL_INVALID", `Sales credits ${l.sale_invoice_number} and it is unlinked first.`);
    const i = await liveIntent(client, l.id);
    if (i && ["POSTING", "POSTED", "RECOVERY_REQUIRED"].includes(i.status)) throw dxError(409, "ASSET_DISPOSAL_ALREADY_POSTED", "The derecognition is posted: Finance reverses it instead.");
    await withdrawIntent(client, l.id, "Asset returned");
    await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'CANCELLED', row_version = row_version + 1 WHERE id = $1`, [l.id]);
    await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "RETURNED_BEFORE_COMPLETION", { from: l.line_status, to: "CANCELLED", reason, details: { evidence: text(input.evidence, 1000) || null, handoverAt: l.handover_at } });
    return { caseId: k.id, lineId: l.id, status: "CANCELLED", caseStatus: await refreshCase(client, await loadCase(client, c, k.id)) };
  }
  if (l.line_status !== "COMPLETED") throw dxError(409, "ASSET_DISPOSAL_INVALID", "Only a completed disposal is reversed.");
  if (kind === "RETURNED_AFTER_SALE") {
    if (k.disposal_type !== "SALE" || !l.sale_invoice_id) throw dxError(409, "ASSET_DISPOSAL_INVALID", "Only a sold asset is returned by its buyer.");
    const note = (await client.query(`SELECT id, invoice_number FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND (invoice_number = $2 OR id::text = $2) AND invoice_type = 'credit_note'
        AND source_invoice_id = $3 AND status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')`, [c.organizationId, text(input.creditNote, 100), l.sale_invoice_id])).rows[0];
    if (!note) throw dxError(409, "ASSET_DISPOSAL_INVALID", `Sales posts the Credit Note against ${l.sale_invoice_number} first, and it is named here.`, { field: "creditNote" });
    const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1`, [l.asset_id])).rows[0];
    const { identifies } = await import("../asset-transfers/tr-commands.js");
    if (!text(input.identifier, 200) || !(await identifies(client, c, a, text(input.identifier, 200)))) throw dxError(409, "ASSET_DISPOSAL_HANDOVER_REQUIRED", `Scan or type ${a.asset_number}'s code, serial or tag as it comes back.`);
    await client.query(`UPDATE tenant.asset_disposal_lines SET return_credit_note_id = $2, returned_at = clock_timestamp() WHERE id = $1`, [l.id, note.id]);
    await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "RETURNED_BY_BUYER", { reason, details: { creditNote: note.invoice_number, condition: text(input.condition, 30) || null } });
  }
  if (l.handover_kind === "DESTRUCTION" && !(input.foundIntact === true && text(input.investigation, 2000).length >= 10)) {
    throw dxError(409, "ASSET_DISPOSAL_INVALID", "An actual destruction cannot be undone. If the asset was found intact, record the investigation to reinstate it.");
  }
  const intent = await liveIntent(client, l.id);
  let reversal = null;
  if (intent?.status === "POSTED") {
    if (!has(c, FINANCE_POST)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED", "Reversing a posted derecognition needs Finance's journal rights.");
    const r = await reverseAssetJournal(client, c, intent.journal_entry_id, `Disposal ${k.case_number} reversed: ${reason}`);
    reversal = r?.reversal?.id ?? r?.entry?.id ?? r?.id ?? null;
  }
  if (intent) await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'REVERSED', reversal_journal_entry_id = $2, result = $3 WHERE id = $1`, [intent.id, reversal, reason]);
  const { withStatusContext } = await import("../asset-status/status-commands.js");
  await withStatusContext(client, c, { action: "REINSTATE", reason: `Disposal ${k.case_number} reversed: ${reason}`, sourceType: "ASSET_DISPOSAL", sourceId: l.id }, async () => {
    await client.query(`UPDATE tenant.assets SET lifecycle_status = 'RETIRED', disposed_at = NULL, net_book_value = CASE WHEN capitalization_class = 'TRACKED_ONLY' THEN net_book_value
        ELSE COALESCE(capitalized_cost, 0) - COALESCE(accumulated_depreciation, 0) - COALESCE(impairment_accumulated, 0) END WHERE id = $1`, [l.asset_id]);
  });
  await client.query(`UPDATE tenant.asset_disposal_lines SET line_status = 'REINSTATED', reinstated_at = clock_timestamp(), reinstated_by = $2, reinstatement_reason = $3, row_version = row_version + 1 WHERE id = $1`, [l.id, c.userId, reason]);
  await logDisposalEvent(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "REVERSED_AND_REINSTATED", { from: "COMPLETED", to: "REINSTATED", reason, details: { reversalJournalEntryId: reversal } });
  await recordAssetEvent(client, c, l.asset_id, "asset.disposal_reversed", { caseId: k.id, reason });
  if (l.capitalization_class !== "TRACKED_ONLY") await raiseException(client, c, k, l, "DEPRECIATION_REVIEW", "Reinstated after a reversed disposal: Finance reviews its depreciation basis and schedule.", "FINANCE");
  return { caseId: k.id, lineId: l.id, status: "REINSTATED", reversalJournalEntryId: reversal, caseStatus: await refreshCase(client, await loadCase(client, c, k.id)) };
}

// ------------------------------------------------------------------ reconciliation queue
async function raiseException(client, c, k, l, code, detail, responsible = "ASSETS", source = null) {
  await client.query(`INSERT INTO tenant.asset_disposal_exceptions (organization_id, case_id, line_id, asset_id, code, detail, responsible, source_document) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (case_id, COALESCE(line_id, case_id), code) WHERE status = 'OPEN' DO UPDATE SET detail = EXCLUDED.detail`, [c.organizationId, k.id, l?.id ?? null, l?.asset_id ?? null, code, detail, responsible, source]);
}
async function resolveExceptions(client, c, lineId, codes, resolution) {
  await client.query(`UPDATE tenant.asset_disposal_exceptions SET status = 'RESOLVED', resolution = $3, resolved_by = $4, resolved_at = clock_timestamp() WHERE line_id = $1 AND status = 'OPEN' AND code = ANY($2::text[])`,
    [lineId, codes, resolution, c.userId ?? null]);
}
// Re-checks every open disposal against the records it depends on; raises what disagrees and resolves what agrees again.
export async function reconcileAssetDisposals(client, c, input = {}) {
  if (c.userId) requireDx(c, DX.reconcile);
  const lines = (await client.query(`SELECT l.*, k.case_number, k.disposal_type, k.proposed_effective_date, k.id AS kid, k.buyer_party_id, k.scrap_method AS case_scrap, a.asset_number, a.lifecycle_status, a.capitalization_class, a.disposed_at
      FROM tenant.asset_disposal_lines l JOIN tenant.asset_disposal_cases k ON k.id = l.case_id JOIN tenant.assets a ON a.id = l.asset_id
      WHERE l.organization_id = $1 AND l.line_status IN ('PENDING_HANDOVER', 'PENDING_FINANCE', 'POSTING', 'RECOVERY_REQUIRED', 'COMPLETED')`, [c.organizationId])).rows;
  let raised = 0; let resolved = 0;
  for (const l of lines) {
    const k = { id: l.kid, case_number: l.case_number, disposal_type: l.disposal_type, proposed_effective_date: l.proposed_effective_date, buyer_party_id: l.buyer_party_id, scrap_method: l.case_scrap };
    const found = new Map();
    const intent = await liveIntent(client, l.id);
    if (l.line_status === "PENDING_HANDOVER") {
      const holder = await custodyOf(client, l.asset_id);
      if (holder && ["EMPLOYEE", "DEPARTMENT"].includes(holder.custodian_type) && !l.custody_exception_reason) found.set("APPROVED_STILL_ASSIGNED", [`Approved for disposal but still held by ${holder.label}.`, "ASSETS"]);
      if (l.sale_invoice_id) found.set("SOLD_NO_HANDOVER", [`Invoiced (${l.sale_invoice_number}) but the handover is not recorded.`, "ASSETS"]);
    }
    if (l.line_status === "PENDING_FINANCE" && l.capitalization_class !== "TRACKED_ONLY" && intent?.status !== "POSTED") found.set("HANDED_OVER_NOT_POSTED", ["The asset has left; Finance has not posted its derecognition.", "FINANCE"]);
    if (intent?.status === "POSTED" && l.line_status !== "COMPLETED") found.set("POSTED_NOT_COMPLETED", ["Derecognition is posted but the asset is not marked disposed: recover it from the posting.", "ASSETS"]);
    if (["POSTING", "RECOVERY_REQUIRED"].includes(intent?.status)) found.set("OUTCOME_UNKNOWN", ["A derecognition posting is being verified.", "FINANCE"]);
    if (l.line_status === "COMPLETED" && l.lifecycle_status !== "DISPOSED") found.set("STATUS_NOT_DISPOSED", ["The disposal is complete but the asset is not Disposed.", "ASSETS"]);
    if (l.sale_invoice_id) {
      const inv = (await client.query(`SELECT status FROM tenant.accounting_customer_invoices WHERE id = $1`, [l.sale_invoice_id])).rows[0];
      if (!inv || !LIVE_BILL.includes(String(inv.status))) found.set("INVOICE_VOIDED", [`${l.sale_invoice_number} is ${inv?.status ?? "missing"} after the disposal.`, "SALES"]);
    }
    if (intent?.status === "PREPARED") {
      const p = await financialPictureOf(client, c, k, l).catch(() => null);
      if (p && !p.tracked && p.basis !== intent.basis_hash) found.set("CARRYING_AMOUNT_CHANGED", ["The carrying value or proceeds changed after Finance confirmed them.", "FINANCE"]);
      if (p?.pendingDepreciation?.length) found.set("FINAL_DEPRECIATION_UNPOSTED", [`Depreciation of ${p.pendingDepreciation.join(", ")} is not posted.`, "FINANCE"]);
    }
    if (l.line_status === "COMPLETED") {
      const after = (await client.query(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_run_lines WHERE asset_id = $1 AND status = 'POSTED' AND period_start > $2::date`, [l.asset_id, dayOfDb(l.actual_disposition_date) ?? dayOfDb(l.proposed_effective_date)]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
      if (Number(after) > 0) found.set("DEPRECIATION_AFTER_DISPOSAL", ["Ordinary depreciation was posted after the disposal.", "FINANCE"]);
      if (!l.handover_at && l.handover_kind !== "LOSS_EVIDENCE") found.set("NO_HANDOVER_EVIDENCE", ["Disposed without a recorded handover.", "ASSETS"]);
    }
    if (l.sale_invoice_id) {
      const inv = (await client.query(`SELECT status, outstanding_amount FROM tenant.accounting_customer_invoices WHERE id = $1`, [l.sale_invoice_id])).rows[0];
      if (inv && LIVE_BILL.includes(String(inv.status)) && toPaise(inv.outstanding_amount ?? 0) === 0n && !l.handover_at && l.line_status === "PENDING_HANDOVER") found.set("BUYER_PAID_NOT_DELIVERED", ["The buyer has paid; the asset has not been delivered.", "ASSETS"]);
      const credit = (await client.query(`SELECT invoice_number FROM tenant.accounting_customer_invoices WHERE source_invoice_id = $1 AND invoice_type = 'credit_note' AND status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed') LIMIT 1`, [l.sale_invoice_id])).rows[0];
      if (credit && l.line_status === "COMPLETED" && !l.returned_at) found.set("CUSTOMER_RETURNED", [`Sales credited the sale (${credit.invoice_number}); record the buyer's return.`, "ASSETS"]);
    }
    if (l.certificate_required && !l.certificate_number && !l.evidence_references && l.handover_at) found.set("SCRAP_CERTIFICATE_MISSING", ["The recycler's certificate or destruction evidence is missing.", "ASSETS"]);
    if (l.line_status !== "COMPLETED" && (await executionIssuesOf(client, k, l)).some((x) => x.code === "ASSET_DISPOSAL_PROCEEDS_MISMATCH")) found.set("PROCEEDS_MISMATCH", ["The asset's proceeds no longer reconcile to its Sales Invoice.", "SALES"]);
    if (intent?.status === "POSTED" && (await journalAgrees(client, intent)) === false) found.set("GL_MISMATCH", ["Finance's journal does not agree with the approved disposal result.", "FINANCE"]);
    const journals = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_disposal_accounting_intents WHERE asset_id = $1 AND status = 'POSTED'`, [l.asset_id])).rows[0].n);
    if (journals > 1) found.set("DUPLICATE_DERECOGNITION", ["More than one posted derecognition for this asset.", "FINANCE"]);
    const open = (await client.query(`SELECT code FROM tenant.asset_disposal_exceptions WHERE line_id = $1 AND status = 'OPEN'`, [l.id])).rows.map((r) => r.code);
    for (const [code, [detail, responsible]] of found) { if (!open.includes(code)) raised += 1; await raiseException(client, c, k, l, code, detail, responsible); }
    const auto = ["APPROVED_STILL_ASSIGNED", "SOLD_NO_HANDOVER", "HANDED_OVER_NOT_POSTED", "POSTED_NOT_COMPLETED", "OUTCOME_UNKNOWN", "STATUS_NOT_DISPOSED", "INVOICE_VOIDED", "CARRYING_AMOUNT_CHANGED", "FINAL_DEPRECIATION_UNPOSTED", "DEPRECIATION_AFTER_DISPOSAL", "DUPLICATE_DERECOGNITION", "NO_HANDOVER_EVIDENCE",
      "BUYER_PAID_NOT_DELIVERED", "CUSTOMER_RETURNED", "SCRAP_CERTIFICATE_MISSING", "PROCEEDS_MISMATCH", "GL_MISMATCH"];
    const gone = open.filter((code) => auto.includes(code) && !found.has(code));
    if (gone.length) { await resolveExceptions(client, c, l.id, gone, "No longer applies"); resolved += gone.length; }
  }
  return { checked: lines.length, raised, resolved };
}
// input: { resolution } — someone responsible records how an exception was resolved (it stays on record).
export async function resolveDisposalException(client, c, exceptionId, input = {}) {
  requireDx(c, DX.reconcile);
  const resolution = text(input.resolution, 1000);
  if (resolution.length < 3) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Describe the resolution.", { field: "resolution" });
  const r = (await client.query(`UPDATE tenant.asset_disposal_exceptions SET status = 'RESOLVED', resolution = $3, resolved_by = $4, resolved_at = clock_timestamp() WHERE organization_id = $1 AND id = $2 AND status = 'OPEN' RETURNING *`,
    [c.organizationId, uuid(exceptionId, "Exception"), resolution, c.userId])).rows[0];
  if (!r) throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND");
  await logDisposalEvent(client, c, { caseId: r.case_id, lineId: r.line_id, assetId: r.asset_id }, "EXCEPTION_RESOLVED", { details: { code: r.code }, reason: resolution });
  return { exceptionId: r.id, status: "RESOLVED" };
}
