// Assets — the module's front door: the dashboard (what needs attention in every workflow, role-aware quick actions, recent activity), one
// control center gathering every Assets exception and reconciliation queue with a link to the workflow that owns it, and a search that finds an
// asset by any identifier without changing anything. Each figure comes from its owning feature, read with the person's own permissions.
import { AssetError, has } from "../common.js";

const today = () => new Date().toISOString().slice(0, 10);
// A feature's own read, or nothing when the person may not see that feature.
async function quietly(run) {
  try { return await run(); } catch (error) { if ([401, 403].includes(error?.status) || /PERMISSION|ACCESS_DENIED/.test(String(error?.code))) return null; throw error; }
}
const asList = (r) => (Array.isArray(r) ? r : Array.isArray(r?.rows) ? r.rows : Array.isArray(r?.items) ? r.items : []);
const EVENT_LABEL = Object.freeze({
  "asset.created": "registered", "asset.registered": "registered", "asset.activated": "brought into use", "asset.condition_recorded": "condition recorded", "asset.depreciated": "depreciated",
  "asset.disposed": "disposed of", "asset.disposal_approved": "approved for disposal", "asset.disposal_handover": "left the Company", "asset.maintenance_requested": "problem reported",
  "asset.maintenance_started": "maintenance started", "asset.returned_to_service": "returned to service", "asset.disposal_reversed": "disposal reversed",
});

export async function getAssetsDashboard(client, c) {
  if (!has(c, "assets.view")) throw new AssetError(403, "You don't have access to assets.", "ASSET_PERMISSION_DENIED");
  const { getAssetRegisterOverview } = await import("../asset-register/register-read.js");
  const { seesRegister } = await import("../asset-register/register-rules.js");
  const register = await getAssetRegisterOverview(client, c);
  const team = seesRegister(c);
  const n = async (sql, values = [c.organizationId]) => Number((await client.query(sql, values)).rows[0].n);
  const queues = [];
  const add = (group, label, value, href, tone = "neutral") => { if (value !== null && value !== undefined) queues.push({ group, label, value: Number(value), href, tone }); };
  if (team) {
    add("Asset Management", "Pending asset registrations", await n(`SELECT count(*)::int AS n FROM tenant.assets WHERE organization_id = $1 AND archived_at IS NULL AND lifecycle_status IN ('DRAFT', 'REGISTERED')`), "/assets/register?view=drafts", "warning");
    add("Asset Management", "In transit", register.counts.inTransfer, "/assets/transfers?view=in_transit");
  }
  if (has(c, "assets.acquisition.view") || has(c, "assets.capitalization.request") || has(c, "assets.capitalization.approve")) {
    add("Acquisition", "Capitalization pending", await n(`SELECT count(*)::int AS n FROM tenant.assets WHERE organization_id = $1 AND archived_at IS NULL AND capitalization_class = 'PENDING' AND lifecycle_status <> 'DRAFT'`), "/assets/capitalization", "warning");
  }
  if (has(c, "assets.assignment.view") || has(c, "assets.assignment.approve")) {
    add("Assignment & Movement", "Assignments awaiting acknowledgment", await n(`SELECT count(*)::int AS n FROM tenant.asset_assignment_requests WHERE organization_id = $1 AND status = 'ISSUED_AWAITING_ACKNOWLEDGMENT' AND returned_at IS NULL`), "/assets/assignments?view=awaiting", "warning");
    add("Assignment & Movement", "Assignment requests pending", await n(`SELECT count(*)::int AS n FROM tenant.asset_assignment_requests WHERE organization_id = $1 AND status IN ('PENDING_APPROVAL')`), "/assets/assignments?view=pending");
  }
  if (has(c, "assets.transfer.view") || has(c, "assets.transfer.approve")) {
    add("Assignment & Movement", "Transfers awaiting receipt", await n(`SELECT count(DISTINCT transfer_id)::int AS n FROM tenant.asset_transfer_lines WHERE organization_id = $1 AND line_status IN ('DISPATCHED', 'RETURN_IN_PROGRESS')`), "/assets/transfers?view=in_transit", "warning");
  }
  const { getMaintenanceOverview } = await import("../asset-maintenance/mt-read.js");
  const mt = await quietly(() => getMaintenanceOverview(client, c));
  if (mt) {
    add("Maintenance", "Under maintenance", register.counts.maintenance, "/assets/register?view=maintenance");
    add("Maintenance", "Service due in 30 days", mt.dueSoon, "/assets/maintenance?view=scheduled");
    add("Maintenance", "Overdue Work Orders", mt.overdue, "/assets/maintenance?view=exceptions", "danger");
    add("Maintenance", "Pending verification", mt.pendingVerification, "/assets/maintenance?view=verification", "warning");
  }
  const { getDepreciationOverview } = await import("../asset-depreciation/dp-read.js");
  const dp = await quietly(() => getDepreciationOverview(client, c));
  if (dp) {
    add("Depreciation", "Asset-months due, not posted", dp.dueLines, "/assets/depreciation?view=assets", "warning");
    add("Depreciation", "Basis out of date", dp.stale, "/assets/depreciation?view=exceptions", "danger");
  }
  const { getDisposalOverview } = await import("../asset-disposal/dx-read.js");
  const dx = await quietly(() => getDisposalOverview(client, c));
  if (dx) {
    add("Disposals", "Disposals awaiting approval", dx.pendingApproval, "/assets/disposals?view=approval", "warning");
    add("Disposals", "Assets pending handover", dx.pendingHandover, "/assets/disposals?view=handover");
    add("Disposals", "Assets pending Finance", dx.pendingFinance, "/assets/disposals?view=finance", "warning");
  }
  // Recent activity on assets the person may see.
  const recent = (await client.query(`SELECT e.event_type, e.occurred_at AS created_at, a.id, a.asset_number, a.name FROM tenant.asset_events e JOIN tenant.assets a ON a.id = e.asset_id
      WHERE e.organization_id = $1 AND ($2::boolean OR a.current_user_id = $3) ORDER BY e.occurred_at DESC LIMIT 12`, [c.organizationId, team, c.userId ?? null])).rows
    .map((e) => ({ asset: `${e.asset_number} · ${e.name}`, what: EVENT_LABEL[e.event_type] ?? e.event_type.replace(/^asset\./, "").replace(/_/g, " "), at: e.created_at, href: `/assets/register/${e.id}` }));
  const actions = [
    has(c, "assets.create") && { label: "Add asset", href: "/assets/register/new" },
    (has(c, "assets.opening.create") || has(c, "assets.opening.upload")) && { label: "Import existing assets", href: "/assets/opening" },
    (has(c, "assets.invoice.create") || has(c, "assets.register_bulk")) && { label: "Create assets from a purchase invoice", href: "/assets/capitalization" },
    has(c, "assets.assignment.request") && { label: "Assign an asset", href: "/assets/assignments" },
    has(c, "assets.transfer.create") && { label: "Transfer an asset", href: "/assets/transfers" },
    has(c, "assets.maintenance.request") && { label: "Report a maintenance issue", href: "/assets/maintenance" },
    has(c, "assets.depreciation.prepare_run") && { label: "Prepare a depreciation run", href: "/assets/depreciation?view=runs" },
    has(c, "assets.disposal.create") && { label: "Request a disposal", href: "/assets/disposals" },
  ].filter(Boolean);
  return { register, queues, recent, actions, team, asOf: today() };
}

// Every Assets exception and reconciliation queue in one place, each item linked to the workflow that resolves it.
export async function getAssetsControlCenter(client, c) {
  if (!has(c, "assets.view")) throw new AssetError(403, "You don't have access to assets.", "ASSET_PERMISSION_DENIED");
  const load = async (path, fn, args = []) => { const m = await import(path); return quietly(() => m[fn](client, c, ...args)); };
  const sources = [
    ["Acquisition / source allocation", "../asset-register/register-read.js", "getAssetExceptions", "/assets/reports?report=duplicate-exceptions"],
    ["Acquisition / source allocation", "../asset-capitalization/cap-read.js", "getAcquisitionExceptions", "/assets/capitalization"],
    ["Acquisition / source allocation", "../asset-invoice/inv-read.js", "getInvoiceExceptions", "/assets/capitalization"],
    ["Identification", "../asset-identification/ident-read.js", "getIdentificationExceptions", "/assets/reports"],
    ["Opening balances", "../asset-opening/opening-read.js", "getOpeningExceptions", "/assets/opening"],
    ["Status", "../asset-status/status-read.js", "getAssetStatusExceptions", "/assets/reports?report=status-conflicts"],
    ["Location / custody", "../asset-locations/location-read.js", "getAssetLocationDiscrepancies", "/assets/locations/discrepancies"],
    ["Location / custody", "../asset-custody/custody-read.js", "getCustodyExceptions", "/assets/custody"],
    ["Transfer / assignment", "../asset-transfers/tr-read.js", "getTransferExceptions", "/assets/transfers"],
    ["Transfer / assignment", "../asset-assignments/asg-read.js", "getAssignmentExceptions", "/assets/assignments"],
    ["Movement history", "../asset-movements/mv-read.js", "getMovementExceptions", "/assets/movements"],
    ["Maintenance cost / status", "../asset-maintenance/mt-read.js", "getMaintenanceExceptions", "/assets/maintenance?view=exceptions"],
    ["Depreciation schedule vs GL", "../asset-depreciation/dp-read.js", "getDepreciationExceptions", "/assets/depreciation?view=exceptions"],
    ["Disposal / Finance", "../asset-disposal/dx-read.js", "listDisposalExceptions", "/assets/disposals?view=exceptions"],
  ];
  const areas = new Map();
  for (const [area, path, fn, fallback] of sources) {
    const result = await load(path, fn);
    if (!areas.has(area)) areas.set(area, { area, items: [], visible: false });
    const slot = areas.get(area);
    if (result === null) continue;
    slot.visible = true;
    const rows = asList(result);
    for (const e of rows) {
      slot.items.push({ label: e.label ?? e.issue ?? e.code?.replace?.(/_/g, " ").toLowerCase() ?? e.kind ?? "Exception", subject: e.subject ?? e.number ?? e.case ?? e.asset ?? e.assetNumber ?? e.record ?? null,
        detail: e.detail ?? e.message ?? e.reason ?? null, href: e.href ?? fallback, source: fn });
    }
  }
  // Failed or unknown Finance postings, wherever they are.
  const { getDepreciationAutomation } = await import("../asset-depreciation-automation/da-read.js");
  const auto = await quietly(() => getDepreciationAutomation(client, c));
  if (auto) {
    if (!areas.has("Failed / unknown postings")) areas.set("Failed / unknown postings", { area: "Failed / unknown postings", items: [], visible: true });
    const slot = areas.get("Failed / unknown postings");
    for (const e of asList(auto.exceptions ?? auto.recent ?? []).filter((x) => /EXCEPTION|RECOVERY|FAILED/.test(String(x.status ?? x.state ?? "")))) {
      slot.items.push({ label: `Depreciation ${String(e.status ?? e.state).toLowerCase().replace(/_/g, " ")}`, subject: e.period ?? e.month ?? null, detail: e.summary ?? e.errorSummary ?? null, href: "/assets/depreciation?view=automation", source: "automation" });
    }
  }
  const unknown = await quietly(async () => {
    if (!has(c, "assets.disposal.view_financials") && !has(c, "assets.depreciation.view")) return null;
    return (await client.query(`SELECT 'disposal' AS kind, k.case_number AS subject, k.id FROM tenant.asset_disposal_accounting_intents i JOIN tenant.asset_disposal_lines l ON l.id = i.line_id JOIN tenant.asset_disposal_cases k ON k.id = l.case_id
        WHERE i.organization_id = $1 AND i.status IN ('POSTING', 'RECOVERY_REQUIRED')
      UNION ALL SELECT 'depreciation', r.run_number, r.id FROM tenant.asset_depreciation_period_runs r WHERE r.organization_id = $1 AND r.status IN ('POSTING', 'RECOVERY_REQUIRED')`, [c.organizationId])).rows;
  });
  if (unknown) {
    if (!areas.has("Failed / unknown postings")) areas.set("Failed / unknown postings", { area: "Failed / unknown postings", items: [], visible: true });
    for (const u of unknown) areas.get("Failed / unknown postings").items.push({ label: "Posting outcome being verified", subject: u.subject, detail: "Verify it against Finance's journal — never post it again.",
      href: u.kind === "disposal" ? `/assets/disposals/${u.id}` : `/assets/depreciation/runs/${u.id}`, source: u.kind });
  }
  const out = [...areas.values()].filter((a) => a.visible);
  return { areas: out.map((a) => ({ area: a.area, count: a.items.length, items: a.items.slice(0, 200) })), total: out.reduce((t, a) => t + a.items.length, 0) };
}

// input: { q } — authorized assets matching a code, name, tag, serial, legacy code, or a linked invoice or transfer reference. Finding never changes anything.
export async function searchAssets(client, c, input = {}) {
  if (!has(c, "assets.view")) throw new AssetError(403, "You don't have access to assets.", "ASSET_PERMISSION_DENIED");
  const raw = String(input.q ?? "").trim().slice(0, 100);
  if (raw.length < 2) return [];
  const { seesRegister } = await import("../asset-register/register-rules.js");
  const { normalizeIdentifier } = await import("../asset-identification/ident-rules.js");
  const n = normalizeIdentifier(raw);
  const like = `%${raw}%`;
  const rows = (await client.query(`SELECT a.id, a.asset_number, a.name, a.lifecycle_status, a.serial_number, a.tag_code,
      CASE WHEN upper(a.asset_number) = upper($2) OR a.serial_normalized = $3 OR a.tag_normalized = $3 OR a.legacy_normalized = $3 OR ('VLAST:' || a.qr_token) = $2 THEN 0 ELSE 1 END AS rank,
      CASE WHEN a.serial_normalized = $3 THEN 'serial' WHEN a.tag_normalized = $3 THEN 'tag' WHEN a.legacy_normalized = $3 THEN 'legacy code' WHEN upper(a.asset_number) = upper($2) THEN 'code'
        WHEN EXISTS (SELECT 1 FROM tenant.asset_transfer_lines tl JOIN tenant.asset_transfer_orders o ON o.id = tl.transfer_id WHERE tl.asset_id = a.id AND upper(o.transfer_number) = upper($2)) THEN 'transfer'
        WHEN EXISTS (SELECT 1 FROM tenant.asset_acquisition_allocations al JOIN tenant.accounting_vendor_bills b ON b.id = al.source_document_id WHERE al.asset_id = a.id AND upper(b.bill_number) = upper($2)) THEN 'source document' ELSE 'name' END AS matched
    FROM tenant.assets a WHERE a.organization_id = $1 AND ($5::boolean OR a.current_user_id = $6)
      AND (upper(a.asset_number) = upper($2) OR a.serial_normalized = $3 OR a.tag_normalized = $3 OR a.legacy_normalized = $3 OR ('VLAST:' || a.qr_token) = $2 OR a.name ILIKE $4 OR a.asset_number ILIKE $4
        OR EXISTS (SELECT 1 FROM tenant.asset_transfer_lines tl JOIN tenant.asset_transfer_orders o ON o.id = tl.transfer_id WHERE tl.asset_id = a.id AND upper(o.transfer_number) = upper($2))
        OR EXISTS (SELECT 1 FROM tenant.asset_acquisition_allocations al JOIN tenant.accounting_vendor_bills b ON b.id = al.source_document_id WHERE al.asset_id = a.id AND upper(b.bill_number) = upper($2)))
    ORDER BY rank, a.asset_number LIMIT 25`, [c.organizationId, raw, n, like, seesRegister(c), c.userId ?? null])).rows;
  return rows.map((r) => ({ id: r.id, asset: `${r.asset_number} · ${r.name}`, lifecycle: r.lifecycle_status, serial: r.serial_number, tag: r.tag_code, matched: r.matched, href: `/assets/register/${r.id}` }));
}
