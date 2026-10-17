// Assets — Asset Register, the reads: the directory (filtered, sorted, paged), one asset's detail by tab, a scan/search lookup that rechecks
// access, the QR label, the overview, the exceptions, the purchase lines still open for registration, the reports and the export.
// Financial values are Finance's — capitalized cost, accumulated depreciation, impairment, carrying amount — shown only to those allowed,
// with their as-of date, and "not capitalized / not configured" rather than a zero.
import { has, loadSettings, qx, text, uuid } from "../common.js";
import { ACQUISITION_METHOD, ASSET, ASSET_TYPE, CAPITALIZATION, CONDITION, CONDITION_UNKNOWN, LIFECYCLE, OWNERSHIP, SOURCE_TYPE, VERIFICATION, assetError, requirePermission, seesFinancials,
  seesRegister } from "./register-rules.js";
import { acquisitionSource, loadAssetRow } from "./register-commands.js";
import { EFFECTIVE_AVAILABILITY, HOLD_REASON } from "../asset-status/status-rules.js";

export const QR_PREFIX = "VLAST:";
const SELECT = `SELECT a.*, cat.code AS category_code, cat.name AS category_name, COALESCE((WITH RECURSIVE up AS (SELECT l.id, l.parent_id, l.name::text AS path FROM tenant.asset_locations l WHERE l.id = a.location_id UNION ALL SELECT p.id, p.parent_id, p.name || ' → ' || up.path FROM tenant.asset_locations p JOIN up ON p.id = up.parent_id) SELECT path FROM up WHERE parent_id IS NULL LIMIT 1), loc.name) AS location_name, dept.name AS department_name,
    COALESCE(NULLIF(u.full_name, ''), u.email) AS custodian_name, party.display_name AS supplier_name,
    (SELECT v.outcome FROM tenant.asset_verifications v WHERE v.asset_id = a.id ORDER BY v.verified_at DESC LIMIT 1) AS last_outcome,
    EXISTS (SELECT 1 FROM tenant.asset_acquisition_allocations al WHERE al.asset_id = a.id AND al.status = 'ACTIVE') AS has_source,
    tenant.asset_effective_availability(a) AS effective_availability,
    (SELECT h.reason_code FROM tenant.asset_holds h WHERE h.asset_id = a.id AND h.status = 'ACTIVE') AS hold_reason,
    EXISTS (SELECT 1 FROM tenant.asset_missing_incidents i WHERE i.asset_id = a.id AND i.status = 'OPEN') AS missing_reported
  FROM tenant.assets a LEFT JOIN tenant.asset_categories cat ON cat.id = a.category_id LEFT JOIN tenant.asset_locations loc ON loc.id = a.location_id
  LEFT JOIN public.departments dept ON dept.id = a.current_department_id LEFT JOIN public.users u ON u.id = a.current_user_id LEFT JOIN tenant.business_parties party ON party.id = a.supplier_id`;
const warrantyState = (end, today, days) => (!end ? "NONE" : end < today ? "EXPIRED" : end <= addDays(today, days) ? "EXPIRING" : "ACTIVE");
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const todayOf = async (client) => (await client.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0].d;

function rowOf(c, row, ctx) {
  const financials = seesFinancials(c);
  const capitalized = row.capitalization_class === "CAPITALIZED";
  return {
    id: row.id, code: row.asset_number, name: row.name, description: row.description, categoryId: row.category_id, category: row.category_name, categoryCode: row.category_code,
    assetType: row.asset_type, assetTypeLabel: ASSET_TYPE[row.asset_type], ownership: row.ownership, ownershipLabel: OWNERSHIP[row.ownership], capitalizationClass: row.capitalization_class,
    capitalizationLabel: CAPITALIZATION[row.capitalization_class], acquisitionMethod: row.acquisition_method, acquisitionMethodLabel: ACQUISITION_METHOD[row.acquisition_method] ?? null,
    manufacturer: row.manufacturer, model: row.model, serialNumber: row.serial_number, tagCode: row.tag_code, legacyCode: row.legacy_asset_code ?? null, labelPrintedAt: row.label_printed_at ?? null,
    lifecycle: row.lifecycle_status, lifecycleLabel: LIFECYCLE[row.lifecycle_status], statusChangedAt: row.status_changed_at ?? null,
    // Availability is derived from the lifecycle, maintenance, transfers and custody (tenant.asset_effective_availability), never stored by hand.
    availability: row.effective_availability ?? "NOT_AVAILABLE", availabilityLabel: EFFECTIVE_AVAILABILITY[row.effective_availability ?? "NOT_AVAILABLE"],
    holdReason: row.hold_reason ?? null, holdReasonLabel: row.hold_reason ? HOLD_REASON[row.hold_reason] : null, missingReported: Boolean(row.missing_reported),
    condition: row.condition, conditionLabel: CONDITION[row.condition] ?? CONDITION_UNKNOWN, criticality: row.criticality,
    locationId: row.location_id, location: row.location_name ?? row.current_location_text ?? null, departmentId: row.current_department_id, department: row.department_name ?? null,
    custodianId: row.current_user_id, custodian: row.custodian_name ?? null, supplierId: row.supplier_id, supplier: row.supplier_name ?? null,
    purchaseDate: row.acquisition_date ?? null, receivedDate: row.received_date ?? null, availableForUseDate: row.placed_in_service_date ?? null,
    warrantyProvider: row.warranty_provider, warrantyReference: row.warranty_reference, warrantyStartDate: row.warranty_start_date ?? null, warrantyEndDate: row.warranty_end_date ?? null,
    warranty: warrantyState(row.warranty_end_date, ctx.today, ctx.alertDays), supportContact: row.support_contact, notes: row.notes,
    lastVerifiedAt: row.last_verified_at, verificationDue: row.lifecycle_status === "ACTIVE" && (!row.last_verified_at || new Date(row.last_verified_at) < new Date(Date.now() - ctx.period * 864e5)),
    lastVerification: row.last_outcome ?? null, hasSource: Boolean(row.has_source), archived: Boolean(row.archived_at), version: row.row_version, createdAt: row.created_at,
    ...(financials ? { carryingAmount: capitalized ? String(row.net_book_value) : null } : {}),
    href: `/assets/register/${row.id}`,
  };
}
async function ctxOf(client, c) {
  const settings = await loadSettings(client, c);
  return { today: await todayOf(client), alertDays: Number(settings.warranty_alert_days ?? 30), period: Number(settings.verification_period_days ?? 365) };
}

// ------------------------------------------------------------------ the directory
const SORT = { status: "a.status_changed_at", code: "a.asset_number", name: "lower(a.name)", category: "lower(cat.name)", location: "lower(loc.name)", custodian: "lower(u.full_name)", lifecycle: "a.lifecycle_status",
  purchase: "a.acquisition_date", warranty: "a.warranty_end_date", created: "a.created_at" };
// filters: { view?, search?, categoryId?, lifecycle?, availability?, condition?, locationId?, departmentId?, custodianId?, ownership?, capitalization?, supplierId?, purchasedFrom?, purchasedTo?,
//   warranty? (expiring|expired), filter? (unverified|no_source|unassigned|missing_serial), archived?, sort?, direction?, page?, pageSize? }
export async function getAssetRegister(client, c, filters = {}) {
  requirePermission(c, ASSET.view);
  const ctx = await ctxOf(client, c);
  const values = [c.organizationId];
  const bind = (v) => { values.push(v); return `$${values.length}`; };
  const where = ["a.organization_id = $1"];
  if (!seesRegister(c)) where.push(`a.current_user_id = ${bind(c.userId)}`);
  where.push(filters.archived === "true" || filters.archived === true ? "a.archived_at IS NOT NULL" : "a.archived_at IS NULL");
  const view = String(filters.view ?? "all");
  if (view === "active") where.push("a.lifecycle_status = 'ACTIVE'");
  if (view === "available") where.push("tenant.asset_effective_availability(a) = 'AVAILABLE'");
  if (view === "maintenance") where.push("tenant.asset_effective_availability(a) = 'UNDER_MAINTENANCE'");
  if (view === "on_hold") where.push("a.lifecycle_status = 'ON_HOLD'");
  if (view === "lost") where.push("(a.lifecycle_status = 'LOST' OR EXISTS (SELECT 1 FROM tenant.asset_missing_incidents i WHERE i.asset_id = a.id AND i.status = 'OPEN'))");
  if (view === "drafts") where.push("a.lifecycle_status IN ('DRAFT', 'REGISTERED')");
  if (view === "ended") where.push("a.lifecycle_status IN ('RETIRED', 'DISPOSED', 'LOST')");
  if (view === "mine") where.push(`a.current_user_id = ${bind(c.userId)}`);
  const eq = (key, col) => { if (filters[key]) where.push(`${col} = ${bind(String(filters[key]))}`); };
  eq("lifecycle", "a.lifecycle_status"); eq("availability", "tenant.asset_effective_availability(a)"); eq("holdReason", "(SELECT h.reason_code FROM tenant.asset_holds h WHERE h.asset_id = a.id AND h.status = 'ACTIVE')"); eq("condition", "a.condition"); eq("ownership", "a.ownership"); eq("capitalization", "a.capitalization_class");
  for (const [key, col] of [["categoryId", "a.category_id"], ["locationId", "a.location_id"], ["departmentId", "a.current_department_id"], ["custodianId", "a.current_user_id"], ["supplierId", "a.supplier_id"]]) {
    if (key === "locationId" && filters.locationId && (filters.locationTree === "true" || filters.locationTree === true)) {
      where.push(`a.location_id IN (WITH RECURSIVE s AS (SELECT id FROM tenant.asset_locations WHERE id = ${bind(uuid(filters.locationId, "Filter"))} UNION ALL SELECT l.id FROM tenant.asset_locations l JOIN s ON l.parent_id = s.id) SELECT id FROM s)`);
    } else if (filters[key]) where.push(`${col} = ${bind(uuid(filters[key], "Filter"))}`);
  }
  if (filters.purchasedFrom) where.push(`a.acquisition_date >= ${bind(String(filters.purchasedFrom).slice(0, 10))}::date`);
  if (filters.purchasedTo) where.push(`a.acquisition_date <= ${bind(String(filters.purchasedTo).slice(0, 10))}::date`);
  if (filters.warranty === "expiring") where.push(`a.warranty_end_date BETWEEN current_date AND current_date + ${bind(ctx.alertDays)}::int`);
  if (filters.warranty === "expired") where.push("a.warranty_end_date < current_date");
  if (filters.filter === "unverified") where.push("a.lifecycle_status = 'ACTIVE'", `(a.last_verified_at IS NULL OR a.last_verified_at < now() - (${bind(ctx.period)}::int || ' days')::interval)`);
  if (filters.filter === "no_source") where.push("a.capitalization_class <> 'TRACKED_ONLY'", "NOT EXISTS (SELECT 1 FROM tenant.asset_acquisition_allocations al WHERE al.asset_id = a.id AND al.status = 'ACTIVE')");
  if (filters.filter === "unassigned") where.push("a.lifecycle_status = 'ACTIVE'", "a.current_user_id IS NULL", "a.current_department_id IS NULL");
  if (filters.filter === "missing_serial") where.push("(a.serial_number IS NULL OR a.tag_code IS NULL)");
  if (filters.search) {
    const term = bind(`%${text(filters.search, 100).replace(/[%_]/g, "\\$&")}%`);
    where.push(`(a.asset_number ILIKE ${term} OR a.name ILIKE ${term} OR a.serial_number ILIKE ${term} OR a.tag_code ILIKE ${term} OR a.legacy_asset_code ILIKE ${term} OR a.model ILIKE ${term} OR a.manufacturer ILIKE ${term})`);
  }
  const sort = SORT[filters.sort] ?? SORT.code;
  const direction = String(filters.direction).toLowerCase() === "desc" ? "DESC" : "ASC";
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 25, 1), 500);
  const page = Math.max(Number(filters.page) || 1, 1);
  const from = `${SELECT} WHERE ${where.join(" AND ")}`;
  const total = Number((await client.query(`SELECT count(*) AS n FROM (${from}) x`, values)).rows[0].n);
  const rows = (await qx(client, `${from} ORDER BY ${sort} ${direction} NULLS LAST, a.asset_number LIMIT ${bind(pageSize)} OFFSET ${bind((page - 1) * pageSize)}`, values)).rows;
  return { rows: rows.map((row) => rowOf(c, row, ctx)), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)),
    can: { create: has(c, ASSET.create), registerBulk: has(c, ASSET.registerBulk), import: has(c, ASSET.import), export: has(c, ASSET.export), financials: seesFinancials(c), categories: has(c, ASSET.categories),
      printLabels: has(c, "assets.identification.bulk_print"), exportIdentifiers: has(c, "assets.identification.export"), bulkStatus: has(c, "assets.status.bulk_action") } };
}

// ------------------------------------------------------------------ one asset
export async function getAsset(client, c, assetId) {
  const base = await loadAssetRow(client, c, assetId);
  const ctx = await ctxOf(client, c);
  const row = (await qx(client, `${SELECT} WHERE a.organization_id = $1 AND a.id = $2`, [c.organizationId, base.id])).rows[0];
  const asset = rowOf(c, row, ctx);
  const { allowedStatusActions } = await import("../asset-status/status-read.js");
  const incident = (await client.query(`SELECT id FROM tenant.asset_missing_incidents WHERE asset_id = $1 AND status = 'OPEN'`, [row.id])).rows[0] ?? null;
  const actions = allowedStatusActions(c, row, { incident });
  return {
    ...asset, qrPayload: `${QR_PREFIX}${row.qr_token}`, parentAssetId: row.parent_asset_id,
    can: { actions, editDraft: row.lifecycle_status === "DRAFT" && has(c, ASSET.editDraft), editDetails: row.lifecycle_status !== "DRAFT" && row.lifecycle_status !== "DISPOSED" && has(c, ASSET.editDetails),
      editCustody: ["DRAFT", "REGISTERED"].includes(row.lifecycle_status) && has(c, row.lifecycle_status === "DRAFT" ? ASSET.editDraft : ASSET.editDetails),
      acquisition: has(c, ASSET.acquisition), verify: has(c, ASSET.verify) && row.lifecycle_status !== "DISPOSED", financials: seesFinancials(c), audit: has(c, ASSET.audit) || seesRegister(c),
      archive: has(c, ASSET.retire) && !row.archived_at && ["DRAFT", "RETIRED", "DISPOSED", "LOST"].includes(row.lifecycle_status), documents: has(c, ASSET.editDetails) || has(c, ASSET.create),
      confirmCost: has(c, ASSET.capitalize), reclassify: has(c, "assets.category.reclassify") && row.lifecycle_status !== "DISPOSED" && !row.archived_at,
      decideReclassification: has(c, "assets.category.manage_financial_policy"),
      printLabel: has(c, "assets.identification.print_label") || has(c, "assets.identification.bulk_print") },
  };
}
// The tab views of one asset: acquisition | financials | custody | warranty | verification | activity
export async function getAssetView(client, c, assetId, view) {
  const asset = await loadAssetRow(client, c, assetId);
  const q = async (sql, values = [asset.id]) => (await qx(client, sql, values)).rows;
  const names = async (ids) => new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [[...new Set(ids.filter(Boolean))]])).rows.map((r) => [r.id, r.name]));
  switch (view) {
    case "acquisition": {
      const rows = await q(`SELECT al.*, to_char(al.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS at FROM tenant.asset_acquisition_allocations al WHERE al.asset_id = $1 ORDER BY al.created_at DESC`);
      const who = await names(rows.map((r) => r.created_by));
      const financials = seesFinancials(c);
      const out = [];
      for (const row of rows) {
        const doc = row.source_type === "SUPPLIER_INVOICE_LINE" ? (await client.query(`SELECT bill.bill_number AS number, bill.id FROM tenant.accounting_vendor_bills bill WHERE bill.id = $1`, [row.source_document_id])).rows[0]
          : row.source_type === "GOODS_RECEIPT_LINE" ? (await client.query(`SELECT receipt_number AS number, id FROM tenant.goods_receipts WHERE id = $1`, [row.source_document_id])).rows[0]
            : row.source_type === "PURCHASE_ORDER_LINE" ? (await client.query(`SELECT purchase_order_number AS number, id FROM tenant.purchase_orders WHERE id = $1`, [row.source_document_id])).rows[0] : null;
        out.push({ id: row.id, number: `AQ-${row.allocation_number}`, sourceType: row.source_type, sourceLabel: SOURCE_TYPE[row.source_type], document: doc?.number ?? null,
          href: row.source_type === "SUPPLIER_INVOICE_LINE" && doc ? `/procurement/supplier-bills/${doc.id}` : row.source_type === "GOODS_RECEIPT_LINE" && doc ? `/procurement/goods-receipts/${doc.id}`
            : row.source_type === "PURCHASE_ORDER_LINE" && doc ? `/procurement/purchase-orders/${doc.id}` : null,
          quantity: Number(row.allocated_quantity), status: row.status, reason: row.reason, by: who.get(row.created_by) ?? null, at: row.created_at,
          ...(financials ? { cost: row.allocated_cost === null ? null : String(row.allocated_cost), costBasis: row.cost_basis, costStatus: row.cost_status, currency: row.currency } : {}),
          reversedAt: row.reversed_at, reversalReason: row.reversal_reason });
      }
      return { method: asset.acquisition_method, methodLabel: ACQUISITION_METHOD[asset.acquisition_method] ?? null, purchaseDate: asset.acquisition_date ?? null, receivedDate: asset.received_date ?? null,
        availableForUseDate: asset.placed_in_service_date ?? null, allocations: out,
        note: "The proposed cost is the source line's tax-exclusive value per unit. Recoverable GST is never capitalized; Finance confirms the acquisition basis." };
    }
    case "financials": {
      if (!seesFinancials(c)) throw assetError(403, "ASSET_PERMISSION_DENIED");
      const capitalized = asset.capitalization_class === "CAPITALIZED";
      const lastRun = capitalized ? (await client.query(`SELECT to_char(max(line.period_end), 'YYYY-MM-DD') AS d FROM tenant.asset_depreciation_run_lines line WHERE line.asset_id = $1 AND line.status = 'POSTED'`, [asset.id]).catch(() => ({ rows: [{}] }))).rows[0]?.d ?? null : null;
      return {
        capitalization: asset.capitalization_class, capitalizationLabel: CAPITALIZATION[asset.capitalization_class],
        message: asset.capitalization_class === "TRACKED_ONLY" ? "Tracked equipment: not capitalized, never depreciated." : capitalized ? null : "Not capitalized yet: Finance confirms the acquisition basis and capitalization.",
        capitalizedCost: capitalized ? String(asset.capitalized_cost) : null, capitalizedAt: asset.capitalized_at ?? null, capitalizationDate: asset.capitalization_date ?? null,
        depreciation: capitalized ? { method: asset.depreciation_method, usefulLifeMonths: asset.useful_life_months, residualValue: String(asset.residual_value), startDate: asset.depreciation_start_date ?? null } : null,
        accumulatedDepreciation: capitalized ? String(asset.accumulated_depreciation) : null, impairment: capitalized ? String(asset.impairment_accumulated) : null,
        carryingAmount: capitalized ? String(asset.net_book_value) : null, asOf: capitalized ? lastRun ?? asset.capitalization_date ?? null : null, currency: asset.currency_code,
        accountingStatus: asset.accounting_status,
        formula: "Net carrying amount = capitalized cost − accumulated depreciation − impairment (+ authorized adjustments), from Finance's postings.",
      };
    }
    case "custody": {
      // The movement history itself is Asset Movement History's (asset-movements/), derived from the source records.
      return { current: { location: asset.location_id, custodian: asset.current_user_id, department: asset.current_department_id, availability: asset.availability_status },
        ownership: OWNERSHIP[asset.ownership], note: "The custodian looks after the asset; the Company stays its owner. Once commissioned, custody changes through assignments and transfers." };
    }
    case "warranty": {
      const rows = await q(`SELECT w.*, to_char(w.start_date, 'YYYY-MM-DD') AS s, to_char(w.end_date, 'YYYY-MM-DD') AS e FROM tenant.asset_warranties w WHERE w.asset_id = $1 ORDER BY w.created_at DESC`);
      const ctx = await ctxOf(client, c);
      const maintenance = (await client.query(`SELECT count(*)::int AS n FROM tenant.asset_maintenance_orders WHERE asset_id = $1 AND status NOT IN ('completed', 'cancelled')`, [asset.id]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
      return { provider: asset.warranty_provider, reference: asset.warranty_reference, startDate: asset.warranty_start_date ?? null, endDate: asset.warranty_end_date ?? null,
        state: warrantyState(asset.warranty_end_date, ctx.today, ctx.alertDays), supportContact: asset.support_contact, openMaintenanceOrders: maintenance, availability: asset.availability_status,
        history: rows.map((r) => ({ id: r.id, provider: r.provider_name, startDate: r.s, endDate: r.e, reference: r.terms, at: r.created_at })) };
    }
    case "verification": {
      const rows = await q(`SELECT v.*, l.name AS observed_location, el.name AS expected_location FROM tenant.asset_verifications v LEFT JOIN tenant.asset_locations l ON l.id = v.observed_location_id
          LEFT JOIN tenant.asset_locations el ON el.id = v.expected_location_id WHERE v.asset_id = $1 ORDER BY v.verified_at DESC`);
      const who = await names(rows.flatMap((r) => [r.verified_by, r.expected_custodian_user_id]));
      return { lastVerifiedAt: asset.last_verified_at, rows: rows.map((r) => ({ id: r.id, outcome: r.outcome, outcomeLabel: VERIFICATION[r.outcome], observedLocation: r.observed_location ?? r.observed_location_text,
        expectedLocation: r.expected_location, expectedCustodian: who.get(r.expected_custodian_user_id) ?? null, condition: r.condition, conditionLabel: CONDITION[r.condition] ?? null, note: r.note, method: r.method,
        by: who.get(r.verified_by) ?? null, at: r.verified_at })),
        note: "A verification records what was observed. It never moves the asset or writes it off." };
    }
    case "activity": {
      const rows = await q(`SELECT e.* FROM tenant.asset_events e WHERE e.asset_id = $1 ORDER BY e.occurred_at DESC LIMIT 300`);
      const who = await names(rows.map((r) => r.actor_user_id));
      return { rows: rows.map((r) => ({ id: r.id, type: r.event_type, payload: has(c, ASSET.audit) || seesRegister(c) ? r.payload : null, by: who.get(r.actor_user_id) ?? null, at: r.occurred_at })) };
    }
    default: throw assetError(404, "ASSET_INPUT_INVALID", "Unknown asset view.");
  }
}

// ------------------------------------------------------------------ scan / search lookup and the label
// A scanned QR payload, an asset code, serial or tag. A label is never an authorization: the person's access is checked as for any read.
// A scan or a typed identifier, resolved by Asset Identification (exact code or QR first; several matches come back as a list to choose from).
export async function lookupAsset(client, c, value) {
  requirePermission(c, ASSET.view);
  const { resolveAssetIdentifier } = await import("../asset-identification/ident-read.js");
  return resolveAssetIdentifier(client, c, value);
}
// The printable label: the QR (an opaque lookup token, nothing private), a Code 128 barcode of the asset code, the code, name and tag.
export async function getAssetLabel(client, c, assetId) {
  const asset = await loadAssetRow(client, c, assetId);
  const { labelOf } = await import("../asset-identification/ident-read.js");
  const label = labelOf(asset);
  return { ...label, svg: label.qrSvg };
}

// ------------------------------------------------------------------ overview and exceptions
export async function getAssetRegisterOverview(client, c) {
  requirePermission(c, ASSET.view);
  const ctx = await ctxOf(client, c);
  const scope = seesRegister(c) ? "TRUE" : "a.current_user_id = $2";
  const values = [c.organizationId, c.userId ?? null, ctx.alertDays, ctx.period];
  const one = async (where) => Number((await client.query(`SELECT count(*) AS n FROM tenant.assets a WHERE a.organization_id = $1 AND a.archived_at IS NULL AND (${scope}) AND ($2::uuid IS NULL OR TRUE)
      AND ($3::int IS NULL OR TRUE) AND ($4::int IS NULL OR TRUE) AND ${where}`, values)).rows[0].n);
  const byStatus = (await client.query(`SELECT a.lifecycle_status AS s, count(*)::int AS n FROM tenant.assets a WHERE a.organization_id = $1 AND a.archived_at IS NULL AND (${scope}) AND ($2::uuid IS NULL OR TRUE) GROUP BY 1`,
    values.slice(0, 2))).rows;
  const byCategory = (await client.query(`SELECT cat.name, count(*)::int AS n FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id = a.category_id WHERE a.organization_id = $1 AND a.archived_at IS NULL
      AND (${scope}) AND ($2::uuid IS NULL OR TRUE) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, values.slice(0, 2))).rows;
  return {
    counts: {
      total: await one("a.lifecycle_status NOT IN ('DISPOSED')"), inUse: await one("tenant.asset_effective_availability(a) = 'ASSIGNED'"),
      available: await one("tenant.asset_effective_availability(a) = 'AVAILABLE'"), maintenance: await one("tenant.asset_effective_availability(a) = 'UNDER_MAINTENANCE'"),
      inTransfer: await one("tenant.asset_effective_availability(a) = 'IN_TRANSFER'"), onHold: await one("a.lifecycle_status = 'ON_HOLD'"),
      missingReports: await one("EXISTS (SELECT 1 FROM tenant.asset_missing_incidents i WHERE i.asset_id = a.id AND i.status = 'OPEN')"),
      drafts: await one("a.lifecycle_status IN ('DRAFT', 'REGISTERED')"), lost: await one("a.lifecycle_status = 'LOST'"),
      unassigned: await one("a.lifecycle_status = 'ACTIVE' AND a.current_user_id IS NULL AND a.current_department_id IS NULL"),
      warrantyExpiring: await one("a.warranty_end_date BETWEEN current_date AND current_date + $3::int AND a.lifecycle_status NOT IN ('DISPOSED', 'RETIRED')"),
      unverified: await one("a.lifecycle_status = 'ACTIVE' AND (a.last_verified_at IS NULL OR a.last_verified_at < now() - ($4::int || ' days')::interval)"),
      noSource: await one("a.capitalization_class <> 'TRACKED_ONLY' AND a.lifecycle_status NOT IN ('DRAFT') AND NOT EXISTS (SELECT 1 FROM tenant.asset_acquisition_allocations al WHERE al.asset_id = a.id AND al.status = 'ACTIVE')"),
    },
    byStatus: Object.keys(LIFECYCLE).map((key) => ({ status: key, label: LIFECYCLE[key], count: byStatus.find((r) => r.s === key)?.n ?? 0 })),
    byCategory, exceptions: seesRegister(c) ? (await getAssetExceptions(client, c)).length : 0,
    statusExceptions: seesRegister(c) ? (await (await import("../asset-status/status-read.js")).getAssetStatusExceptions(client, c)).length : 0, can: { create: has(c, ASSET.create), registerBulk: has(c, ASSET.registerBulk), import: has(c, ASSET.import) },
  };
}
export async function getAssetExceptions(client, c) {
  requirePermission(c, ASSET.view);
  if (!seesRegister(c)) return [];
  const q = async (sql) => (await qx(client, sql, [c.organizationId])).rows;
  const out = [];
  for (const row of await q(`SELECT al.source_line_id, al.source_type, count(*)::int AS n FROM tenant.asset_acquisition_allocations al WHERE al.organization_id = $1 AND al.status = 'ACTIVE' AND al.source_line_id IS NOT NULL GROUP BY 1, 2`)) {
    try {
      const source = await acquisitionSource(client, c, row.source_type, row.source_line_id);
      if (source.claimed > source.quantity) out.push({ kind: "SOURCE_OVERALLOCATED", message: `${source.document_number}: ${source.claimed} assets registered for ${source.quantity} unit(s).` });
    } catch (failure) { out.push({ kind: "SOURCE_MISSING", message: `An acquisition source line is no longer available (${failure.message}).` }); }
  }
  for (const row of await q(`SELECT id, asset_number, name FROM tenant.assets a WHERE a.organization_id = $1 AND a.archived_at IS NULL AND a.lifecycle_status = 'ACTIVE' AND a.capitalization_class <> 'TRACKED_ONLY'
      AND a.ownership = 'owned' AND NOT EXISTS (SELECT 1 FROM tenant.asset_acquisition_allocations al WHERE al.asset_id = a.id AND al.status = 'ACTIVE') LIMIT 100`))
    out.push({ kind: "NO_SOURCE", assetId: row.id, message: `${row.asset_number} · ${row.name} is in use without an acquisition source.` });
  for (const row of await q(`SELECT a.id, a.asset_number, a.name FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id = a.category_id WHERE a.organization_id = $1 AND a.archived_at IS NULL AND cat.serial_number_policy = 'REQUIRED'
      AND a.serial_number IS NULL AND a.lifecycle_status NOT IN ('DISPOSED') LIMIT 100`))
    out.push({ kind: "MISSING_SERIAL", assetId: row.id, message: `${row.asset_number} · ${row.name} has no serial number, which its category requires.` });
  for (const row of await q(`SELECT DISTINCT ON (v.asset_id) v.asset_id, v.outcome, a.asset_number, a.name FROM tenant.asset_verifications v JOIN tenant.assets a ON a.id = v.asset_id WHERE v.organization_id = $1
      AND a.archived_at IS NULL ORDER BY v.asset_id, v.verified_at DESC`)) {
    if (row.outcome !== "FOUND") out.push({ kind: "VERIFICATION_DISCREPANCY", assetId: row.asset_id, message: `${row.asset_number} · ${row.name}: last verification — ${VERIFICATION[row.outcome].toLowerCase()}.` });
  }
  for (const row of await q(`SELECT al.asset_id, a.asset_number FROM tenant.asset_acquisition_allocations al JOIN tenant.assets a ON a.id = al.asset_id WHERE al.organization_id = $1 AND al.status = 'ACTIVE'
      AND al.cost_status = 'PROPOSED' AND a.capitalization_class = 'PENDING' AND a.lifecycle_status = 'ACTIVE' LIMIT 100`))
    out.push({ kind: "COST_REVIEW", assetId: row.asset_id, message: `${row.asset_number}: Finance to confirm the acquisition cost.` });
  return out;
}

// ------------------------------------------------------------------ purchase lines open for registration
export async function listAcquisitionSources(client, c, filters = {}) {
  if (!has(c, ASSET.registerBulk) && !has(c, ASSET.acquisition) && !has(c, ASSET.create)) throw assetError(403, "ASSET_PERMISSION_DENIED");
  const search = text(filters.search, 100);
  const rows = (await client.query(`SELECT 'SUPPLIER_INVOICE_LINE' AS type, line.id, bill.bill_number AS document, to_char(bill.bill_date, 'YYYY-MM-DD') AS date, line.description, COALESCE(line.invoiced_quantity, line.quantity) AS quantity,
        party.display_name AS supplier FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id LEFT JOIN tenant.business_parties party ON party.id = bill.party_id
       WHERE line.organization_id = $1 AND bill.bill_type = 'bill' AND bill.status IN ('approved', 'posted', 'partially_paid', 'paid', 'overdue', 'disputed')
         AND ($2 = '' OR bill.bill_number ILIKE '%' || $2 || '%' OR line.description ILIKE '%' || $2 || '%' OR party.display_name ILIKE '%' || $2 || '%')
     UNION ALL SELECT 'GOODS_RECEIPT_LINE', line.id, receipt.receipt_number, to_char(receipt.receipt_date, 'YYYY-MM-DD'), line.description, COALESCE(line.base_quantity, line.accepted_quantity), party.display_name
        FROM tenant.goods_receipt_lines line JOIN tenant.goods_receipts receipt ON receipt.id = line.goods_receipt_id LEFT JOIN tenant.business_parties party ON party.id = receipt.supplier_id
       WHERE line.organization_id = $1 AND receipt.status = 'posted' AND ($2 = '' OR receipt.receipt_number ILIKE '%' || $2 || '%' OR line.description ILIKE '%' || $2 || '%')
     ORDER BY 4 DESC NULLS LAST LIMIT 200`, [c.organizationId, search])).rows;
  const out = [];
  for (const row of rows) {
    const source = await acquisitionSource(client, c, row.type, row.id).catch(() => null);
    if (!source || source.available < 1) continue;
    out.push({ sourceType: row.type, sourceLabel: SOURCE_TYPE[row.type], sourceLineId: row.id, documentId: source.document_id, document: row.document, date: row.date, description: row.description, supplier: row.supplier,
      quantity: source.quantity, registered: source.claimed, available: source.available, ...(seesFinancials(c) ? { proposedUnitCost: source.unitCost } : {}) });
  }
  return { rows: out };
}

// ------------------------------------------------------------------ categories and form options
export async function getAssetRegisterOptions(client, c) {
  requirePermission(c, ASSET.view);
  const q = async (sql) => (await client.query(sql, [c.organizationId])).rows;
  return {
    categories: await q(`SELECT id, code, name, asset_type, capitalization_guidance, serial_number_policy, asset_tag_policy, location_required, custodian_policy, suggested_condition, default_department_id
        FROM tenant.asset_categories WHERE organization_id = $1 AND active AND deleted_at IS NULL ORDER BY name`),
    locations: await (await import("../asset-locations/location-read.js")).getLocationChoices(client, c),
    departments: await q(`SELECT id, code, name FROM public.departments WHERE organization_id = $1 ORDER BY name`),
    users: await q(`SELECT u.id, u.email, COALESCE(NULLIF(u.full_name, ''), u.email) AS name FROM public.users u JOIN public.organization_memberships m ON m.user_id = u.id
        WHERE m.organization_id = $1 AND m.status = 'active' AND u.status = 'active' ORDER BY 3 LIMIT 1000`),
    suppliers: await q(`SELECT id, code, display_name AS name FROM tenant.business_parties WHERE organization_id = $1 AND party_type IN ('supplier', 'both') AND status = 'active' ORDER BY display_name LIMIT 1000`),
    labels: { lifecycle: LIFECYCLE, availability: EFFECTIVE_AVAILABILITY, holdReason: HOLD_REASON, condition: CONDITION, assetType: ASSET_TYPE, capitalization: CAPITALIZATION, ownership: OWNERSHIP, acquisitionMethod: ACQUISITION_METHOD },
  };
}

// ------------------------------------------------------------------ reports and export
export const ASSET_REGISTER_REPORTS = Object.freeze(["register", "by-category", "by-location", "by-department", "by-custodian", "by-lifecycle", "unassigned", "available", "maintenance",
  "acquisition-history", "missing-identifiers", "duplicate-exceptions", "warranty-expiry", "verification-exceptions", "capitalized-vs-tracked", "financial-summary", "import-reconciliation"]);
export async function getAssetRegisterReport(client, c, kind = "register") {
  const identification = await import("../asset-identification/ident-read.js");
  if (identification.IDENT_REPORTS.includes(kind)) return identification.getIdentificationReport(client, c, kind);
  const status = await import("../asset-status/status-read.js");
  if (status.STATUS_REPORTS.includes(kind)) return status.getAssetStatusReport(client, c, kind);
  const locations = await import("../asset-locations/location-read.js");
  if (locations.LOCATION_REPORTS.includes(kind)) return locations.getAssetLocationReport(client, c, kind);
  const custody = await import("../asset-custody/custody-read.js");
  if (custody.CUSTODY_REPORTS.includes(kind)) return custody.getCustodyReport(client, c, kind);
  if (!ASSET_REGISTER_REPORTS.includes(kind)) throw assetError(400, "ASSET_INPUT_INVALID", "Unknown report.");
  requirePermission(c, ASSET.view);
  if (!seesRegister(c)) throw assetError(403, "ASSET_PERMISSION_DENIED");
  if (kind === "financial-summary" && !seesFinancials(c)) throw assetError(403, "ASSET_PERMISSION_DENIED");
  const all = (await getAssetRegister(client, c, { pageSize: 500 })).rows;
  const group = (key, label) => {
    const map = new Map();
    for (const row of all) { const k = row[key] ?? "—"; const g = map.get(k) ?? { group: row[label] ?? "Not set", total: 0, active: 0, assigned: 0, available: 0 }; g.total += 1;
      if (row.lifecycle === "ACTIVE") g.active += 1; if (row.availability === "ASSIGNED") g.assigned += 1; if (row.availability === "AVAILABLE" && row.lifecycle === "ACTIVE") g.available += 1; map.set(k, g); }
    return [...map.values()].sort((a, b) => b.total - a.total);
  };
  const pick = (rows) => rows.map((r) => ({ id: r.id, code: r.code, name: r.name, category: r.category, serialNumber: r.serialNumber, tagCode: r.tagCode, location: r.location, custodian: r.custodian,
    lifecycle: r.lifecycleLabel, availability: r.availabilityLabel, condition: r.conditionLabel, purchaseDate: r.purchaseDate, warrantyEndDate: r.warrantyEndDate, warranty: r.warranty, href: r.href }));
  switch (kind) {
    case "register": return pick(all);
    case "by-category": return group("categoryId", "category");
    case "by-location": return group("locationId", "location");
    case "by-department": return group("departmentId", "department");
    case "by-custodian": return group("custodianId", "custodian");
    case "by-lifecycle": return group("lifecycle", "lifecycleLabel");
    case "unassigned": return pick(all.filter((r) => r.lifecycle === "ACTIVE" && !r.custodianId && !r.departmentId));
    case "available": return pick(all.filter((r) => r.lifecycle === "ACTIVE" && r.availability === "AVAILABLE"));
    case "maintenance": return pick(all.filter((r) => r.availability === "UNDER_MAINTENANCE"));
    case "missing-identifiers": return pick(all.filter((r) => !r.serialNumber || !r.tagCode)).map((r) => ({ ...r, missing: [!r.serialNumber && "serial", !r.tagCode && "tag"].filter(Boolean).join(", ") }));
    case "warranty-expiry": return pick(all.filter((r) => r.warranty === "EXPIRING" || r.warranty === "EXPIRED"));
    case "verification-exceptions": return (await getAssetExceptions(client, c)).filter((e) => e.kind === "VERIFICATION_DISCREPANCY").concat(pick(all.filter((r) => r.verificationDue)).map((r) => ({ kind: "VERIFICATION_DUE", assetId: r.id, message: `${r.code} · ${r.name}: not verified within the period.` })));
    case "duplicate-exceptions": return (await getAssetExceptions(client, c)).filter((e) => ["SOURCE_OVERALLOCATED", "SOURCE_MISSING"].includes(e.kind));
    case "capitalized-vs-tracked": {
      const map = new Map();
      for (const r of all) map.set(r.capitalizationClass, { class: r.capitalizationLabel, count: (map.get(r.capitalizationClass)?.count ?? 0) + 1 });
      return [...map.values()];
    }
    case "acquisition-history": return (await qx(client, `SELECT al.allocation_number, al.source_type, al.status, al.created_at, a.asset_number, a.name, a.id FROM tenant.asset_acquisition_allocations al JOIN tenant.assets a ON a.id = al.asset_id
        WHERE al.organization_id = $1 ORDER BY al.created_at DESC LIMIT 500`, [c.organizationId])).rows.map((r) => ({ number: `AQ-${r.allocation_number}`, asset: `${r.asset_number} · ${r.name}`, source: SOURCE_TYPE[r.source_type], status: r.status, at: r.created_at, href: `/assets/register/${r.id}` }));
    case "financial-summary": return all.filter((r) => r.capitalizationClass === "CAPITALIZED").map((r) => ({ code: r.code, name: r.name, category: r.category, carryingAmount: r.carryingAmount, href: r.href }));
    case "import-reconciliation": return (await client.query(`SELECT batch.*, (SELECT count(*)::int FROM tenant.assets a WHERE a.registration_batch_id = batch.id) AS assets FROM tenant.asset_registration_batches batch
        WHERE batch.organization_id = $1 ORDER BY batch.created_at DESC LIMIT 200`, [c.organizationId])).rows.map((r) => ({ number: `ARB-${r.batch_number}`, kind: r.kind, file: r.file_name, requested: r.requested_count,
      created: r.created_count, failed: r.failed_count, assets: r.assets, status: r.status, at: r.created_at, consistent: r.status === "PREVIEW" || r.assets === r.created_count }));
    default: return [];
  }
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function exportAssetRegister(client, c, filters = {}) {
  requirePermission(c, ASSET.export);
  const data = await getAssetRegister(client, c, { ...filters, page: 1, pageSize: 500 });
  const financials = seesFinancials(c);
  const header = ["Asset code", "Name", "Category", "Type", "Tracking", "Ownership", "Manufacturer", "Model", "Serial", "Tag", "Lifecycle", "Availability", "Condition", "Location", "Department", "Custodian",
    "Purchase date", "Available for use", "Warranty end", ...(financials ? ["Carrying amount"] : [])];
  const lines = data.rows.map((r) => [r.code, r.name, r.category, r.assetTypeLabel, r.capitalizationLabel, r.ownershipLabel, r.manufacturer, r.model, r.serialNumber, r.tagCode, r.lifecycleLabel, r.availabilityLabel,
    r.conditionLabel, r.location, r.department, r.custodian, r.purchaseDate, r.availableForUseDate, r.warrantyEndDate, ...(financials ? [r.carryingAmount ?? "Not capitalized"] : [])]);
  return { fileName: `asset-register-${await todayOf(client)}.csv`, csv: [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n"), count: lines.length };
}
