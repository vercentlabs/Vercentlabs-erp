// Assets — Asset Location, the reads: the location directory (paths, direct and sub-location asset counts, manager, external party), the
// tree, one location's detail with its child locations, assets and change history, each asset's location picture (registered location,
// custodian and department apart, pending destination, current whereabouts, last sighting, open discrepancy, history), the discrepancy
// queue, the reports and the export.
import { has, qx, uuid } from "../common.js";
import { LIFECYCLE, seesRegister } from "../asset-register/register-rules.js";
import { DISCREPANCY_STATUS, EVENT_LABEL, EXTERNAL_KINDS, KIND, LOCATION, OBSERVATION_KIND, PATHS_SQL, locationError, mayCreateLocation, mayEditLocation, seesLocationHistory } from "./location-rules.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
const IN_USE = "a.archived_at IS NULL AND a.lifecycle_status <> 'DISPOSED'";
const DIRECTORY = `WITH paths AS (${PATHS_SQL}),
  direct AS (SELECT a.location_id, count(*)::int AS n FROM tenant.assets a WHERE a.organization_id = $1 AND ${IN_USE} GROUP BY 1)
  SELECT l.*, p.path, p.root_id, p.depth, COALESCE(d.n, 0) AS direct_assets,
    (WITH RECURSIVE s AS (SELECT l.id AS id UNION ALL SELECT c.id FROM tenant.asset_locations c JOIN s ON c.parent_id = s.id)
      SELECT count(*)::int FROM tenant.assets a WHERE a.location_id IN (SELECT id FROM s) AND ${IN_USE}) AS subtree_assets,
    (SELECT count(*)::int FROM tenant.asset_locations c WHERE c.parent_id = l.id) AS children,
    ${NAME("m")} AS manager_name, party.display_name AS external_party, root.name AS site_name
  FROM tenant.asset_locations l JOIN paths p ON p.id = l.id LEFT JOIN direct d ON d.location_id = l.id LEFT JOIN public.users m ON m.id = l.manager_user_id
  LEFT JOIN tenant.business_parties party ON party.id = l.external_party_id LEFT JOIN tenant.asset_locations root ON root.id = p.root_id
  WHERE l.organization_id = $1`;
function shape(row) {
  return { id: row.id, code: row.code, name: row.name, path: row.path, kind: row.kind, kindLabel: KIND[row.kind] ?? row.kind, parentId: row.parent_id, siteId: row.root_id, site: row.site_name, depth: row.depth,
    description: row.description, floorRoom: row.floor_room, address: row.address, managerUserId: row.manager_user_id, manager: row.manager_name ?? null, externalPartyId: row.external_party_id,
    externalParty: row.external_party ?? null, external: EXTERNAL_KINDS.includes(row.kind), isAssetStore: Boolean(row.is_asset_store), active: row.active, directAssets: row.direct_assets, subtreeAssets: row.subtree_assets, children: row.children,
    version: row.row_version, createdAt: row.created_at, href: `/assets/locations/${row.id}` };
}
const canOf = (c) => ({ create: mayCreateLocation(c), edit: mayEditLocation(c), deactivate: has(c, LOCATION.deactivate) || has(c, LOCATION.legacyManage), hierarchy: has(c, LOCATION.hierarchy),
  history: seesLocationHistory(c), review: has(c, LOCATION.review), export: has(c, LOCATION.export) });

// filters: { status? (active|inactive|all), kind?, siteId?, hasAssets?, missingManager?, external?, search? }
export async function getAssetLocations(client, c, filters = {}) {
  if (!has(c, LOCATION.view)) throw locationError(403, "ASSET_LOCATION_ACCESS_DENIED");
  const values = [c.organizationId];
  const where = [];
  const bind = (v) => { values.push(v); return `$${values.length}`; };
  const status = String(filters.status ?? "active");
  if (status === "active") where.push("l.active");
  if (status === "inactive") where.push("NOT l.active");
  if (filters.kind) where.push(`l.kind = ${bind(String(filters.kind))}`);
  if (filters.siteId) where.push(`p.root_id = ${bind(uuid(filters.siteId, "Site"))}`);
  if (filters.missingManager === "true" || filters.missingManager === true) where.push("l.manager_user_id IS NULL");
  if (filters.external === "true" || filters.external === true) where.push(`l.kind IN ('CUSTOMER_SITE', 'REPAIR_FACILITY')`);
  if (filters.search) { const t = bind(`%${String(filters.search).slice(0, 100).replace(/[%_]/g, "\\$&")}%`); where.push(`(l.name ILIKE ${t} OR l.code ILIKE ${t} OR p.path ILIKE ${t} OR l.floor_room ILIKE ${t})`); }
  let rows = (await qx(client, `${DIRECTORY}${where.length ? ` AND ${where.join(" AND ")}` : ""} ORDER BY p.path`, values)).rows.map(shape);
  if (filters.hasAssets === "true" || filters.hasAssets === true) rows = rows.filter((r) => r.subtreeAssets > 0);
  return { rows, can: canOf(c) };
}
// The active locations as choices for a form, labelled by their full path.
export async function getLocationChoices(client, c) {
  return (await qx(client, `WITH paths AS (${PATHS_SQL}) SELECT l.id, l.code, l.name, l.kind, p.path FROM tenant.asset_locations l JOIN paths p ON p.id = l.id WHERE l.organization_id = $1 AND l.active ORDER BY p.path`,
    [c.organizationId])).rows.map((r) => ({ id: r.id, code: r.code, name: r.path, shortName: r.name, kind: r.kind }));
}
export async function getAssetLocation(client, c, locationId) {
  if (!has(c, LOCATION.view)) throw locationError(403, "ASSET_LOCATION_ACCESS_DENIED");
  let id;
  try { id = uuid(locationId, "Location"); } catch { throw locationError(404, "ASSET_LOCATION_NOT_FOUND"); }
  const row = (await qx(client, `${DIRECTORY} AND l.id = $2`, [c.organizationId, id])).rows[0];
  if (!row) throw locationError(404, "ASSET_LOCATION_NOT_FOUND");
  const children = (await qx(client, `${DIRECTORY} AND l.parent_id = $2 ORDER BY l.name`, [c.organizationId, id])).rows.map(shape);
  const parent = row.parent_id ? (await qx(client, `${DIRECTORY} AND l.id = $2`, [c.organizationId, row.parent_id])).rows[0] : null;
  return { ...shape(row), parent: parent ? { id: parent.id, path: parent.path, active: parent.active } : null, childLocations: children, can: canOf(c) };
}
export async function getAssetLocationChanges(client, c, locationId) {
  if (!seesLocationHistory(c) && !mayEditLocation(c)) throw locationError(403, "ASSET_LOCATION_ACCESS_DENIED");
  const rows = (await client.query(`SELECT x.*, ${NAME("u")} AS actor FROM tenant.asset_location_changes x LEFT JOIN public.users u ON u.id = x.actor_user_id WHERE x.organization_id = $1 AND x.location_id = $2 ORDER BY x.occurred_at DESC`,
    [c.organizationId, uuid(locationId, "Location")])).rows;
  const arrivals = (await client.query(`SELECT e.*, a.asset_number, a.name AS asset_name, ${NAME("u")} AS actor FROM tenant.asset_location_events e JOIN tenant.assets a ON a.id = e.asset_id LEFT JOIN public.users u ON u.id = e.changed_by
      WHERE e.organization_id = $1 AND (e.new_location_id = $2 OR e.previous_location_id = $2) ORDER BY e.recorded_at DESC LIMIT 300`, [c.organizationId, uuid(locationId, "Location")])).rows;
  return {
    changes: rows.map((r) => ({ id: r.id, action: r.action, changes: r.changes, reason: r.reason, by: r.actor, at: r.occurred_at })),
    movements: arrivals.map((e) => ({ id: e.id, asset: `${e.asset_number} · ${e.asset_name}`, assetId: e.asset_id, direction: e.new_location_id === uuid(locationId, "Location") ? "IN" : "OUT", event: EVENT_LABEL[e.event_type], by: e.actor, at: e.recorded_at })),
  };
}

// ------------------------------------------------------------------ one asset's location picture
export async function getAssetLocationView(client, c, assetId) {
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  const asset = await loadAssetRow(client, c, assetId);
  const paths = new Map((await qx(client, PATHS_SQL, [c.organizationId])).rows.map((r) => [r.id, r.path]));
  const pathOf = (id) => (id ? paths.get(id) ?? null : null);
  const people = async (id) => (id ? (await client.query(`SELECT ${NAME("u")} AS n FROM public.users u WHERE u.id = $1`, [id])).rows[0]?.n ?? null : null);
  const dept = asset.current_department_id ? (await client.query(`SELECT name FROM public.departments WHERE id = $1`, [asset.current_department_id])).rows[0]?.name ?? null : null;
  const pending = (await client.query(`SELECT o.transfer_number, l.to_location_id, l.line_status AS status, o.created_at FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id
      WHERE l.asset_id = $1 AND l.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS') AND l.to_location_id IS NOT NULL ORDER BY o.created_at DESC LIMIT 1`, [asset.id])).rows[0] ?? null;
  const observations = (await client.query(`SELECT o.*, ${NAME("u")} AS observer FROM tenant.asset_location_observations o LEFT JOIN public.users u ON u.id = o.observed_by WHERE o.asset_id = $1 ORDER BY o.observed_at DESC LIMIT 50`, [asset.id])).rows;
  const now = Date.now();
  const current = observations.find((o) => o.kind !== "VERIFICATION" && !o.ended_at && (!o.expires_at || new Date(o.expires_at).getTime() > now)) ?? null;
  const sighting = observations.find((o) => o.kind === "VERIFICATION") ?? null;
  const discrepancy = (await client.query(`SELECT * FROM tenant.asset_location_discrepancies WHERE asset_id = $1 AND status = 'OPEN'`, [asset.id])).rows[0] ?? null;
  const obs = (o) => ({ id: o.id, kind: o.kind, kindLabel: OBSERVATION_KIND[o.kind], location: pathOf(o.observed_location_id) ?? o.observed_location_text, at: o.observed_at, until: o.expires_at, ended: o.ended_at,
    reason: o.reason, by: o.observer, differs: o.discrepancy });
  const history = seesLocationHistory(c) || seesRegister(c) ? (await client.query(`SELECT e.*, ${NAME("u")} AS actor FROM tenant.asset_location_events e LEFT JOIN public.users u ON u.id = e.changed_by WHERE e.asset_id = $1 ORDER BY e.recorded_at DESC`, [asset.id])).rows
    .map((e) => ({ id: e.id, from: pathOf(e.previous_location_id), to: pathOf(e.new_location_id), event: e.event_type, eventLabel: EVENT_LABEL[e.event_type], reason: e.reason, by: e.actor, at: e.recorded_at, effective: e.effective_at })) : [];
  return {
    assetId: asset.id, version: asset.row_version, registeredLocationId: asset.location_id, registeredLocation: pathOf(asset.location_id) ?? asset.current_location_text ?? null,
    custodian: await people(asset.current_user_id), department: dept, lifecycle: asset.lifecycle_status, lifecycleLabel: LIFECYCLE[asset.lifecycle_status],
    pendingDestination: pending ? { transfer: pending.transfer_number, to: pathOf(pending.to_location_id), since: pending.created_at, status: pending.status } : null,
    currentWhereabouts: current ? obs(current) : null, lastSighting: sighting ? obs(sighting) : null, lastVerifiedAt: asset.last_verified_at ?? null,
    discrepancy: discrepancy ? { id: discrepancy.id, number: `LDS-${discrepancy.discrepancy_number}`, expected: pathOf(discrepancy.expected_location_id), observed: pathOf(discrepancy.observed_location_id) ?? discrepancy.observed_location_text,
      reportedAt: discrepancy.reported_at, source: discrepancy.source } : null,
    observations: observations.map(obs), history,
    note: "The registered location is the last confirmed official location; transfers change it, whereabouts and sightings never do.",
    can: { observe: has(c, LOCATION.observe) && asset.lifecycle_status !== "DISPOSED", review: has(c, LOCATION.review), correct: has(c, LOCATION.review) && asset.lifecycle_status !== "DISPOSED" && !asset.archived_at,
      transfer: has(c, "assets.transfer") && ["ACTIVE", "ON_HOLD"].includes(asset.lifecycle_status) },
  };
}

// ------------------------------------------------------------------ discrepancies, reports, export
export async function getAssetLocationDiscrepancies(client, c, filters = {}) {
  if (!has(c, LOCATION.review) && !seesRegister(c)) throw locationError(403, "ASSET_LOCATION_ACCESS_DENIED");
  const paths = new Map((await qx(client, PATHS_SQL, [c.organizationId])).rows.map((r) => [r.id, r.path]));
  const status = String(filters.status ?? "OPEN");
  const rows = (await client.query(`SELECT d.*, a.asset_number, a.name AS asset_name, ${NAME("r")} AS reporter, ${NAME("v")} AS resolver FROM tenant.asset_location_discrepancies d JOIN tenant.assets a ON a.id = d.asset_id
      LEFT JOIN public.users r ON r.id = d.reported_by LEFT JOIN public.users v ON v.id = d.resolved_by WHERE d.organization_id = $1 ${status === "all" ? "" : "AND d.status = $2"} ORDER BY d.reported_at DESC LIMIT 500`,
    status === "all" ? [c.organizationId] : [c.organizationId, status])).rows;
  return { rows: rows.map((d) => ({ id: d.id, number: `LDS-${d.discrepancy_number}`, assetId: d.asset_id, asset: `${d.asset_number} · ${d.asset_name}`, expected: paths.get(d.expected_location_id) ?? "No location",
    observed: paths.get(d.observed_location_id) ?? d.observed_location_text, observedLocationId: d.observed_location_id, source: d.source, status: d.status, statusLabel: DISCREPANCY_STATUS[d.status],
    reportedBy: d.reporter, reportedAt: d.reported_at, resolvedBy: d.resolver, resolution: d.resolution_note, href: `/assets/register/${d.asset_id}?tab=custody` })), can: { review: has(c, LOCATION.review) } };
}
export const LOCATION_REPORTS = Object.freeze(["assets-by-location", "assets-by-site", "no-location", "external-whereabouts", "pending-transfers", "location-discrepancies", "inactive-with-assets",
  "location-history", "lost-by-last-location", "utilization-by-category", "location-change-audit"]);
export async function getAssetLocationReport(client, c, kind) {
  if (!LOCATION_REPORTS.includes(kind)) throw locationError(400, "ASSET_LOCATION_INVALID", "Unknown report.");
  if (!seesRegister(c)) throw locationError(403, "ASSET_LOCATION_ACCESS_DENIED");
  const q = async (sql) => (await qx(client, sql, [c.organizationId])).rows;
  const paths = new Map((await qx(client, PATHS_SQL, [c.organizationId])).rows.map((r) => [r.id, r.path]));
  switch (kind) {
    case "assets-by-location": return (await getAssetLocations(client, c, { status: "all" })).rows.map((r) => ({ location: r.path, type: r.kindLabel, here: r.directAssets, includingSubLocations: r.subtreeAssets, status: r.active ? "Active" : "Inactive", href: r.href }));
    case "assets-by-site": return (await getAssetLocations(client, c, { status: "all" })).rows.filter((r) => !r.parentId).map((r) => ({ site: r.name, type: r.kindLabel, assets: r.subtreeAssets, href: r.href }));
    case "no-location": return (await q(`SELECT a.id, a.asset_number, a.name, a.lifecycle_status FROM tenant.assets a WHERE a.organization_id = $1 AND a.location_id IS NULL AND ${IN_USE} ORDER BY a.asset_number`))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, status: LIFECYCLE[r.lifecycle_status], href: `/assets/register/${r.id}` }));
    case "external-whereabouts": return (await q(`SELECT a.id, a.asset_number, a.name, a.location_id, o.observed_location_id, o.observed_location_text, o.kind, o.expires_at FROM tenant.assets a
        LEFT JOIN LATERAL (SELECT * FROM tenant.asset_location_observations x WHERE x.asset_id = a.id AND x.kind <> 'VERIFICATION' AND x.ended_at IS NULL AND (x.expires_at IS NULL OR x.expires_at > now()) ORDER BY x.observed_at DESC LIMIT 1) o ON true
        WHERE a.organization_id = $1 AND ${IN_USE} AND (o.id IS NOT NULL OR a.location_id IN (SELECT id FROM tenant.asset_locations WHERE kind IN ('CUSTOMER_SITE', 'REPAIR_FACILITY'))) ORDER BY a.asset_number`))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, registered: paths.get(r.location_id) ?? "—", whereabouts: paths.get(r.observed_location_id) ?? r.observed_location_text ?? "At an external registered location", kind: r.kind ? OBSERVATION_KIND[r.kind] : "Registered there",
        until: r.expires_at ? String(r.expires_at).slice(0, 10) : "—", href: `/assets/register/${r.id}` }));
    case "pending-transfers": return (await q(`SELECT o.transfer_number, l.line_status AS status, o.created_at, l.from_location_id, l.to_location_id, a.id, a.asset_number, a.name FROM tenant.asset_transfer_lines l
        JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id JOIN tenant.assets a ON a.id = l.asset_id WHERE l.organization_id = $1 AND l.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS') AND l.to_location_id IS NOT NULL ORDER BY o.created_at`)).map((r) => ({ transfer: r.transfer_number, asset: `${r.asset_number} · ${r.name}`, from: paths.get(r.from_location_id) ?? "—",
      to: paths.get(r.to_location_id) ?? "—", status: r.status, since: String(r.created_at).slice(0, 10), href: `/assets/register/${r.id}` }));
    case "location-discrepancies": return (await getAssetLocationDiscrepancies(client, c, { status: "all" })).rows.map((r) => ({ number: r.number, asset: r.asset, expected: r.expected, observed: r.observed, status: r.statusLabel, href: r.href }));
    case "inactive-with-assets": return (await getAssetLocations(client, c, { status: "inactive" })).rows.filter((r) => r.directAssets > 0).map((r) => ({ location: r.path, assets: r.directAssets, href: r.href }));
    case "location-history": return (await q(`SELECT e.*, a.asset_number, a.name, ${NAME("u")} AS actor FROM tenant.asset_location_events e JOIN tenant.assets a ON a.id = e.asset_id LEFT JOIN public.users u ON u.id = e.changed_by
        WHERE e.organization_id = $1 ORDER BY e.recorded_at DESC LIMIT 1000`)).map((e) => ({ asset: `${e.asset_number} · ${e.name}`, from: paths.get(e.previous_location_id) ?? "—", to: paths.get(e.new_location_id) ?? "—",
      event: EVENT_LABEL[e.event_type], reason: e.reason ?? "—", by: e.actor ?? "—", at: e.recorded_at, href: `/assets/register/${e.asset_id}` }));
    case "lost-by-last-location": return (await q(`SELECT a.id, a.asset_number, a.name, a.location_id FROM tenant.assets a WHERE a.organization_id = $1 AND a.lifecycle_status = 'LOST' ORDER BY a.location_id, a.asset_number`))
      .map((r) => ({ lastKnownLocation: paths.get(r.location_id) ?? "Unknown", asset: `${r.asset_number} · ${r.name}`, href: `/assets/register/${r.id}` }));
    case "utilization-by-category": return (await q(`SELECT a.location_id, cat.name AS category, count(*)::int AS n FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id = a.category_id WHERE a.organization_id = $1 AND ${IN_USE}
        GROUP BY 1, 2 ORDER BY 1, 3 DESC`)).map((r) => ({ location: paths.get(r.location_id) ?? "No location", category: r.category, assets: r.n }));
    case "location-change-audit": return (await q(`SELECT x.*, l.id AS lid, ${NAME("u")} AS actor FROM tenant.asset_location_changes x JOIN tenant.asset_locations l ON l.id = x.location_id LEFT JOIN public.users u ON u.id = x.actor_user_id
        WHERE x.organization_id = $1 ORDER BY x.occurred_at DESC LIMIT 1000`)).map((r) => ({ location: paths.get(r.lid) ?? "—", action: r.action.toLowerCase(), reason: r.reason ?? "—", by: r.actor ?? "—", at: r.occurred_at, href: `/assets/locations/${r.lid}` }));
    default: return [];
  }
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function exportAssetLocations(client, c) {
  if (!has(c, LOCATION.export)) throw locationError(403, "ASSET_LOCATION_ACCESS_DENIED");
  const { rows } = await getAssetLocations(client, c, { status: "all" });
  const header = ["Code", "Name", "Path", "Type", "Floor / room", "Address", "Manager", "Customer or vendor", "Assets here", "Assets including sub-locations", "Status"];
  return { fileName: "asset-locations.csv", csv: [header, ...rows.map((r) => [r.code, r.name, r.path, r.kindLabel, r.floorRoom, r.address, r.manager, r.externalParty, r.directAssets, r.subtreeAssets, r.active ? "Active" : "Inactive"])]
    .map((l) => l.map(csvCell).join(",")).join("\r\n") };
}
// The customers and vendors an external location may belong to.
export async function getLocationParties(client, c) {
  if (!has(c, LOCATION.view)) throw locationError(403, "ASSET_LOCATION_ACCESS_DENIED");
  return (await client.query(`SELECT id, display_name AS name, party_type FROM tenant.business_parties WHERE organization_id = $1 AND status = 'active' ORDER BY display_name LIMIT 2000`, [c.organizationId])).rows;
}
