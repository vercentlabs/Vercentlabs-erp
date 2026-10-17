// Assets — Opening / Existing Assets, the reads: the overview (progress, cutover, what waits), batches and their rows (with errors, warnings
// and match candidates), the Finance summary and reconciliation against Finance's opening balances per account, exceptions, each
// asset's opening history, reports, the template (CSV or Excel) and the row results export.
import { has, qx, uuid } from "../common.js";
import { LIFECYCLE, seesRegister } from "../asset-register/register-rules.js";
import { BATCH_STATUS, COLUMNS, EXAMPLE, OPENING, POSITION_STATUS, ROW_STATUS, dayOfDb, openingError, seesOpening, seesOpeningValues } from "./opening-rules.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
const requireSees = (c) => { if (!seesOpening(c) && !seesRegister(c)) throw openingError(403, "ASSET_OPENING_PERMISSION_DENIED"); };
function batchOf(b) {
  return { id: b.id, number: `OPN-${b.batch_number}`, source: b.source, fileName: b.file_name, cutoverDate: dayOfDb(b.cutover_date), status: b.status, statusLabel: BATCH_STATUS[b.status],
    rows: b.row_count, registered: b.registered_count, exceptions: b.exception_count, financeMode: b.finance_mode, financeOpeningBalanceId: b.finance_opening_balance_id, varianceNote: b.variance_note,
    createdBy: b.created_by_name ?? null, createdAt: b.created_at, approvedBy: b.approved_by_name ?? null, approvedAt: b.approved_at, closedAt: b.closed_at, version: b.row_version, href: `/assets/opening/${b.id}` };
}
const BATCH = `SELECT b.*, ${NAME("u")} AS created_by_name, ${NAME("ap")} AS approved_by_name FROM tenant.asset_opening_batches b LEFT JOIN public.users u ON u.id = b.created_by LEFT JOIN public.users ap ON ap.id = b.approved_by`;

export async function getOpeningOverview(client, c) {
  requireSees(c);
  const settings = (await client.query(`SELECT opening_cutover_date FROM tenant.asset_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  const n = async (sql) => Number((await client.query(sql, [c.organizationId])).rows[0].n);
  const totals = seesOpeningValues(c) ? (await client.query(`SELECT COALESCE(sum(capitalized_cost), 0) AS cost, COALESCE(sum(accumulated_depreciation), 0) AS acc, COALESCE(sum(accumulated_impairment), 0) AS imp,
      COALESCE(sum(opening_carrying_amount), 0) AS carrying FROM tenant.asset_opening_positions WHERE organization_id = $1`, [c.organizationId])).rows[0] : null;
  return {
    cutoverDate: settings?.opening_cutover_date ? dayOfDb(settings.opening_cutover_date) : null,
    counts: {
      migrated: await n(`SELECT count(*)::int AS n FROM tenant.asset_opening_rows WHERE organization_id = $1 AND status IN ('REGISTERED', 'LINKED')`),
      openBatches: await n(`SELECT count(*)::int AS n FROM tenant.asset_opening_batches WHERE organization_id = $1 AND status IN ('DRAFT', 'NEEDS_CORRECTION', 'READY_FOR_CONFIRMATION', 'REGISTERING', 'RECOVERY_REQUIRED')`),
      pendingFinance: await n(`SELECT count(*)::int AS n FROM tenant.asset_opening_batches WHERE organization_id = $1 AND status = 'REGISTERED_PENDING_FINANCE'`),
      rowExceptions: await n(`SELECT count(*)::int AS n FROM tenant.asset_opening_rows r JOIN tenant.asset_opening_batches b ON b.id = r.batch_id WHERE r.organization_id = $1 AND r.status IN ('INVALID', 'DUPLICATE') AND b.status NOT IN ('CANCELLED', 'CLOSED')`),
      needsReview: await n(`SELECT count(*)::int AS n FROM tenant.asset_opening_positions WHERE organization_id = $1 AND status = 'NEEDS_REVIEW'`),
    },
    totals: totals ? { cost: String(totals.cost), accumulatedDepreciation: String(totals.acc), impairment: String(totals.imp), carrying: String(totals.carrying) } : null,
    can: { create: has(c, OPENING.create), upload: has(c, OPENING.upload), financials: seesOpeningValues(c), approve: has(c, OPENING.approve) },
  };
}
// filters: { status?: open | finance | completed | all }
export async function listOpeningBatches(client, c, filters = {}) {
  requireSees(c);
  const groups = { open: "('DRAFT', 'NEEDS_CORRECTION', 'READY_FOR_CONFIRMATION', 'REGISTERING', 'RECOVERY_REQUIRED')", finance: "('REGISTERED_PENDING_FINANCE', 'RECONCILED')", completed: "('CLOSED', 'CANCELLED')" };
  const where = groups[filters.status] ? `AND b.status IN ${groups[filters.status]}` : "";
  return { rows: (await qx(client, `${BATCH} WHERE b.organization_id = $1 ${where} ORDER BY b.created_at DESC LIMIT 500`, [c.organizationId])).rows.map(batchOf) };
}
// One batch with its rows (filters: { rowStatus?, search? }), its open Finance work and what the person may do.
export async function getOpeningBatch(client, c, batchId, filters = {}) {
  requireSees(c);
  let id;
  try { id = uuid(batchId, "Migration batch"); } catch { throw openingError(404, "ASSET_OPENING_NOT_FOUND"); }
  const b = (await qx(client, `${BATCH} WHERE b.organization_id = $1 AND b.id = $2`, [c.organizationId, id])).rows[0];
  if (!b) throw openingError(404, "ASSET_OPENING_NOT_FOUND");
  const values = [b.id];
  const where = ["r.batch_id = $1"];
  if (filters.rowStatus) { values.push(String(filters.rowStatus)); where.push(`r.status = $${values.length}`); }
  if (filters.search) { values.push(`%${String(filters.search).slice(0, 100).replace(/[%_]/g, "\\$&")}%`); where.push(`(r.data->>'name' ILIKE $${values.length} OR r.data->>'existing_asset_code' ILIKE $${values.length} OR r.data->>'serial_number' ILIKE $${values.length})`); }
  const rows = (await client.query(`SELECT r.*, a.asset_number FROM tenant.asset_opening_rows r LEFT JOIN tenant.assets a ON a.id = r.asset_id WHERE ${where.join(" AND ")} ORDER BY r.row_number LIMIT 2000`, values)).rows;
  const values2 = seesOpeningValues(c);
  const positions = values2 ? (await client.query(`SELECT p.*, a.asset_number, a.name FROM tenant.asset_opening_positions p JOIN tenant.assets a ON a.id = p.asset_id WHERE p.batch_id = $1 ORDER BY a.asset_number`, [b.id])).rows : [];
  const open = !["CLOSED", "CANCELLED", "RECONCILED"].includes(b.status);
  return {
    ...batchOf(b),
    counts: Object.fromEntries(Object.keys(ROW_STATUS).map((k) => [k, rows.filter((r) => r.status === k).length])),
    rows: rows.map((r) => ({ row: r.row_number, status: r.status, statusLabel: ROW_STATUS[r.status], name: r.data?.name ?? r.raw?.name ?? null, existingCode: r.data?.existing_asset_code || null,
      category: r.data?.category ?? null, serialNumber: r.data?.serial_number || null, location: r.data?.location ?? null, lifecycle: r.data?.lifecycle ?? null, lifecycleLabel: r.data?.lifecycle ? LIFECYCLE[r.data.lifecycle] : null,
      errors: r.errors, warnings: r.warnings, matches: r.matches, resolution: r.resolution, linkAssetId: r.link_asset_id, assetId: r.asset_id, assetNumber: r.asset_number, corrections: r.data?.corrections ?? {},
      values: values2 && r.data?.position ? { cost: r.data.position.capitalizedCost, accumulated: r.data.position.accumulatedDepreciation, carrying: r.data.position.openingCarryingAmount, remaining: r.data.position.remaining } : undefined,
      raw: r.raw })),
    positions: positions.map((p) => ({ id: p.id, assetId: p.asset_id, asset: `${p.asset_number} · ${p.name}`, currency: p.currency, originalCost: p.original_cost === null ? null : String(p.original_cost),
      capitalizedCost: String(p.capitalized_cost), accumulatedDepreciation: String(p.accumulated_depreciation), accumulatedImpairment: String(p.accumulated_impairment), otherAdjustments: String(p.other_adjustments),
      openingCarryingAmount: String(p.opening_carrying_amount), residualValue: String(p.residual_value), method: p.depreciation_method, remaining: p.remaining_useful_life_months, evidence: p.evidence,
      status: p.status, statusLabel: POSITION_STATUS[p.status], reviewNote: p.review_note, version: p.version })),
    can: {
      edit: open && has(c, OPENING.edit), validate: open && has(c, OPENING.validate), register: open && has(c, OPENING.register) && rows.some((r) => r.status === "VALID"),
      cancel: has(c, OPENING.create) && b.registered_count === 0 && !["CANCELLED", "CLOSED"].includes(b.status),
      financials: values2, approve: b.status === "REGISTERED_PENDING_FINANCE" && has(c, OPENING.approve) && b.created_by !== c.userId,
      prepare: b.status === "REGISTERED_PENDING_FINANCE" && has(c, OPENING.approve) && has(c, "accounting.journal.create") && !b.finance_opening_balance_id, close: b.status === "RECONCILED" && has(c, OPENING.close),
      correct: b.status === "CLOSED" && has(c, OPENING.correct), export: has(c, OPENING.export), audit: has(c, OPENING.audit) || has(c, OPENING.approve),
    },
  };
}
// Asset totals per Finance account (cost at the category's asset account, accumulated depreciation and impairment at its accumulated
// depreciation account), against Finance's opening balances: those posted on or before the cutover, or the draft prepared from this batch.
export async function getOpeningReconciliation(client, c, batchId) {
  if (!seesOpeningValues(c)) throw openingError(403, "ASSET_OPENING_PERMISSION_DENIED");
  const b = (await client.query(`SELECT * FROM tenant.asset_opening_batches WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(batchId, "Migration batch")])).rows[0];
  if (!b) throw openingError(404, "ASSET_OPENING_NOT_FOUND");
  const groups = (await client.query(`SELECT cat.name AS category, cat.asset_account_id, cat.accumulated_depreciation_account_id, p.currency, sum(p.capitalized_cost) AS cost,
      sum(p.accumulated_depreciation + p.accumulated_impairment) AS accumulated, sum(p.opening_carrying_amount) AS carrying, count(*)::int AS assets
      FROM tenant.asset_opening_positions p JOIN tenant.assets a ON a.id = p.asset_id JOIN tenant.asset_categories cat ON cat.id = a.category_id WHERE p.batch_id = $1 GROUP BY 1, 2, 3, 4`, [b.id])).rows;
  const accounts = new Map();
  const unmapped = [];
  const add = (accountId, measure, side, amount, category) => {
    if (!accountId) { unmapped.push({ category, measure }); return; }
    const k = `${accountId}:${side}`;
    const cur = accounts.get(k) ?? { accountId, measure, side, register: 0, categories: new Set() };
    cur.register += Number(amount); cur.categories.add(category); accounts.set(k, cur);
  };
  for (const g of groups) { add(g.asset_account_id, "Cost", "DEBIT", g.cost, g.category); add(g.accumulated_depreciation_account_id, "Accumulated depreciation", "CREDIT", g.accumulated, g.category); }
  const finance = b.finance_opening_balance_id
    ? (await client.query(`SELECT account_id, sum(debit) AS debit, sum(credit) AS credit FROM tenant.accounting_opening_balance_lines WHERE opening_balance_id = $1 GROUP BY 1`, [b.finance_opening_balance_id])).rows
    : (await client.query(`SELECT l.account_id, sum(l.debit) AS debit, sum(l.credit) AS credit FROM tenant.accounting_opening_balance_lines l JOIN tenant.accounting_opening_balances o ON o.id = l.opening_balance_id
        WHERE o.organization_id = $1 AND o.status = 'POSTED' AND o.as_of_date <= $2 GROUP BY 1`, [c.organizationId, dayOfDb(b.cutover_date)])).rows;
  const fin = new Map(finance.map((f) => [f.account_id, f]));
  const names = new Map((await client.query(`SELECT id, code, name FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, [...accounts.values()].map((a) => a.accountId)])).rows.map((r) => [r.id, `${r.code} · ${r.name}`]));
  const lines = [...accounts.values()].map((a) => {
    const f = fin.get(a.accountId);
    const amount = f ? (a.side === "DEBIT" ? Number(f.debit) - Number(f.credit) : Number(f.credit) - Number(f.debit)) : 0;
    const variance = Math.round((a.register - amount) * 100) / 100;
    return { accountId: a.accountId, account: names.get(a.accountId) ?? a.accountId, measure: a.measure, side: a.side, categories: [...a.categories], register: a.register.toFixed(2), finance: amount.toFixed(2), variance: variance.toFixed(2), matched: variance === 0 };
  });
  const totals = groups.reduce((t, g) => ({ cost: t.cost + Number(g.cost), accumulated: t.accumulated + Number(g.accumulated), carrying: t.carrying + Number(g.carrying), assets: t.assets + g.assets }), { cost: 0, accumulated: 0, carrying: 0, assets: 0 });
  return { batchId: b.id, cutoverDate: dayOfDb(b.cutover_date), source: b.finance_opening_balance_id ? "PREPARED" : "POSTED",
    totals: { cost: totals.cost.toFixed(2), accumulated: totals.accumulated.toFixed(2), carrying: totals.carrying.toFixed(2), assets: totals.assets }, lines,
    unmapped: unmapped.map((u) => ({ ...u, note: `${u.category} has no Finance account for ${u.measure.toLowerCase()}; set the category's financial policy.` })),
    matched: lines.length > 0 && lines.every((l) => l.matched) && unmapped.length === 0,
    note: "Totals must agree per account, not only overall. Nothing is posted from Assets: Finance's opening balances stay Finance's." };
}
export async function getOpeningExceptions(client, c) {
  requireSees(c);
  const rows = (await client.query(`SELECT r.row_number, r.status, r.errors, r.matches, r.data->>'name' AS name, b.id AS batch_id, b.batch_number FROM tenant.asset_opening_rows r JOIN tenant.asset_opening_batches b ON b.id = r.batch_id
      WHERE r.organization_id = $1 AND r.status IN ('INVALID', 'DUPLICATE') AND b.status NOT IN ('CANCELLED', 'CLOSED') ORDER BY b.batch_number, r.row_number LIMIT 2000`, [c.organizationId])).rows;
  return rows.map((r) => ({ batch: `OPN-${r.batch_number}`, row: r.row_number, name: r.name, kind: r.status === "DUPLICATE" ? "Possible duplicate" : "Needs correction",
    issue: r.status === "DUPLICATE" ? `Matches ${r.matches.map((m) => `${m.code} (${m.reason})`).join(", ")}` : r.errors.map((e) => e.message).join(" "), href: `/assets/opening/${r.batch_id}?row=${r.row_number}` }));
}
// Every migration event — of one batch, or of them all.
export async function getOpeningHistory(client, c, batchId) {
  if (!has(c, OPENING.audit) && !has(c, OPENING.approve)) throw openingError(403, "ASSET_OPENING_PERMISSION_DENIED");
  const values = [c.organizationId];
  if (batchId) values.push(uuid(batchId, "Migration batch"));
  return (await client.query(`SELECT e.*, ${NAME("u")} AS actor, a.asset_number, b.batch_number FROM tenant.asset_opening_events e JOIN tenant.asset_opening_batches b ON b.id = e.batch_id
      LEFT JOIN public.users u ON u.id = e.actor_user_id LEFT JOIN tenant.assets a ON a.id = e.asset_id
      WHERE e.organization_id = $1 ${batchId ? "AND e.batch_id = $2" : ""} ORDER BY e.occurred_at DESC LIMIT 1000`, values)).rows
    .map((e) => ({ id: e.id, batch: `OPN-${e.batch_number}`, batchId: e.batch_id, action: e.action, actionLabel: EVENT_LABEL[e.action] ?? e.action, details: e.details, reason: e.reason, asset: e.asset_number, by: e.actor, at: e.occurred_at }));
}
const EVENT_LABEL = Object.freeze({ CREATED: "Started", VALIDATED: "Validated", ROW_CORRECTED: "Row corrected", CANCELLED: "Cancelled", REGISTERED: "Assets registered", POSITION_REVIEWED: "Opening value reviewed",
  FINANCE_PREPARED: "Finance opening balance prepared", FINANCE_APPROVED: "Opening values approved", CLOSED: "Closed", POSITION_CORRECTED: "Locked value corrected" });
// The asset's opening history, for its Acquisition tab.
export async function getAssetOpening(client, c, assetId) {
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  const asset = await loadAssetRow(client, c, assetId);
  const row = (await client.query(`SELECT r.*, b.batch_number, b.cutover_date, b.status AS batch_status, b.id AS bid FROM tenant.asset_opening_rows r JOIN tenant.asset_opening_batches b ON b.id = r.batch_id
      WHERE r.asset_id = $1 AND r.status IN ('REGISTERED', 'LINKED') LIMIT 1`, [asset.id])).rows[0];
  if (!row) return { migrated: false };
  const p = seesOpeningValues(c) || has(c, "assets.view_financials") ? (await client.query(`SELECT * FROM tenant.asset_opening_positions WHERE asset_id = $1`, [asset.id])).rows[0] : null;
  const corrections = p ? (await client.query(`SELECT e.*, ${NAME("u")} AS actor FROM tenant.asset_opening_events e LEFT JOIN public.users u ON u.id = e.actor_user_id WHERE e.asset_id = $1 AND e.action IN ('POSITION_REVIEWED', 'POSITION_CORRECTED') ORDER BY e.occurred_at DESC`, [asset.id])).rows : [];
  return {
    migrated: true, linked: row.status === "LINKED", batch: `OPN-${row.batch_number}`, batchHref: `/assets/opening/${row.bid}`, row: row.row_number, cutoverDate: dayOfDb(row.cutover_date),
    legacyCode: asset.legacy_asset_code ?? null, acquisitionDate: dayOfDb(asset.acquisition_date), supplier: row.data?.supplier || null, purchaseReference: row.data?.purchase_reference || null, evidence: row.data?.evidence || null,
    position: p ? { currency: p.currency, originalCost: p.original_cost === null ? null : String(p.original_cost), capitalizedCost: String(p.capitalized_cost), accumulatedDepreciation: String(p.accumulated_depreciation),
      accumulatedImpairment: String(p.accumulated_impairment), openingCarryingAmount: String(p.opening_carrying_amount), remaining: p.remaining_useful_life_months, status: p.status, statusLabel: POSITION_STATUS[p.status], version: p.version } : null,
    corrections: corrections.map((e) => ({ action: e.action, reason: e.reason, by: e.actor, at: e.occurred_at, details: e.details })),
    note: "Brought in from the earlier register: its history before the cutover is not recreated, and its opening values are Finance's.",
  };
}

// ------------------------------------------------------------------ reports, template, export
export const OPENING_REPORTS = Object.freeze(["opening-register", "opening-by-category", "opening-cost-summary", "opening-accumulated-depreciation", "opening-carrying-value", "fully-depreciated-active",
  "without-purchase-evidence", "migration-duplicates", "missing-location-custodian", "unmatched-historical-codes", "pending-finance-approval", "migration-batch-history"]);
export async function getOpeningReport(client, c, kind) {
  if (!OPENING_REPORTS.includes(kind)) throw openingError(400, "ASSET_OPENING_INVALID", "Unknown report.");
  requireSees(c);
  const money = ["opening-cost-summary", "opening-accumulated-depreciation", "opening-carrying-value", "fully-depreciated-active"].includes(kind);
  if (money && !seesOpeningValues(c)) throw openingError(403, "ASSET_OPENING_PERMISSION_DENIED");
  const q = async (sql) => (await qx(client, sql, [c.organizationId])).rows;
  const REG = `FROM tenant.asset_opening_rows r JOIN tenant.assets a ON a.id = r.asset_id JOIN tenant.asset_opening_batches b ON b.id = r.batch_id LEFT JOIN tenant.asset_categories cat ON cat.id = a.category_id
    LEFT JOIN tenant.asset_opening_positions p ON p.asset_id = a.id WHERE r.organization_id = $1 AND r.status IN ('REGISTERED', 'LINKED')`;
  switch (kind) {
    case "opening-register": return (await q(`SELECT a.id, a.asset_number, a.name, a.legacy_asset_code, cat.name AS category, a.lifecycle_status, b.batch_number ${REG} ORDER BY a.asset_number`))
      .map((r) => ({ code: r.asset_number, name: r.name, previousCode: r.legacy_asset_code ?? "—", category: r.category, status: LIFECYCLE[r.lifecycle_status], batch: `OPN-${r.batch_number}`, href: `/assets/register/${r.id}` }));
    case "opening-by-category": return (await q(`SELECT cat.name AS category, count(*)::int AS assets ${REG} GROUP BY 1 ORDER BY 2 DESC`));
    case "opening-cost-summary": case "opening-accumulated-depreciation": case "opening-carrying-value":
      return (await q(`SELECT cat.name AS category, p.currency, count(p.id)::int AS assets, COALESCE(sum(p.capitalized_cost), 0) AS cost, COALESCE(sum(p.accumulated_depreciation), 0) AS accumulated,
          COALESCE(sum(p.accumulated_impairment), 0) AS impairment, COALESCE(sum(p.opening_carrying_amount), 0) AS carrying ${REG} AND p.id IS NOT NULL GROUP BY 1, 2 ORDER BY 1`))
        .map((r) => ({ category: r.category, currency: r.currency, assets: r.assets, ...(kind === "opening-cost-summary" ? { cost: String(r.cost) } : kind === "opening-accumulated-depreciation" ? { accumulatedDepreciation: String(r.accumulated), impairment: String(r.impairment) } : { cost: String(r.cost), accumulated: String(r.accumulated), carrying: String(r.carrying) }) }));
    case "fully-depreciated-active": return (await q(`SELECT a.id, a.asset_number, a.name, p.capitalized_cost, p.residual_value ${REG} AND p.opening_carrying_amount <= p.residual_value AND a.lifecycle_status = 'ACTIVE' ORDER BY a.asset_number`))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, cost: String(r.capitalized_cost), residual: String(r.residual_value), href: `/assets/register/${r.id}` }));
    case "without-purchase-evidence": return (await q(`SELECT a.id, a.asset_number, a.name ${REG} AND COALESCE(r.data->>'evidence', '') = '' AND a.capitalization_class <> 'TRACKED_ONLY' ORDER BY a.asset_number`))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, href: `/assets/register/${r.id}` }));
    case "migration-duplicates": return (await getOpeningExceptions(client, c)).filter((e) => e.kind === "Possible duplicate");
    case "missing-location-custodian": return (await q(`SELECT a.id, a.asset_number, a.name, a.location_id, a.current_user_id, a.current_department_id, a.current_store_location_id ${REG} AND a.lifecycle_status IN ('ACTIVE', 'REGISTERED', 'ON_HOLD')
        AND (a.location_id IS NULL OR (a.current_user_id IS NULL AND a.current_department_id IS NULL AND a.current_store_location_id IS NULL)) ORDER BY a.asset_number`))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, missing: [!r.location_id && "location", !r.current_user_id && !r.current_department_id && !r.current_store_location_id && "custodian"].filter(Boolean).join(", "), href: `/assets/register/${r.id}` }));
    case "unmatched-historical-codes": return (await q(`SELECT r.row_number, r.data->>'existing_asset_code' AS code, r.data->>'name' AS name, r.status, b.batch_number, b.id FROM tenant.asset_opening_rows r JOIN tenant.asset_opening_batches b ON b.id = r.batch_id
        WHERE r.organization_id = $1 AND COALESCE(r.data->>'existing_asset_code', '') <> '' AND r.status NOT IN ('REGISTERED', 'LINKED', 'SKIPPED') AND b.status <> 'CANCELLED' ORDER BY b.batch_number, r.row_number`))
      .map((r) => ({ previousCode: r.code, name: r.name, batch: `OPN-${r.batch_number}`, row: r.row_number, status: ROW_STATUS[r.status], href: `/assets/opening/${r.id}?row=${r.row_number}` }));
    case "pending-finance-approval": return (await listOpeningBatches(client, c, { status: "finance" })).rows.filter((b) => b.status === "REGISTERED_PENDING_FINANCE").map((b) => ({ batch: b.number, registered: b.registered, cutover: b.cutoverDate, since: b.createdAt, href: b.href }));
    case "migration-batch-history": return (await listOpeningBatches(client, c, {})).rows.map((b) => ({ batch: b.number, source: b.source === "FILE" ? b.fileName : "Entered by hand", cutover: b.cutoverDate, status: b.statusLabel, rows: b.rows, registered: b.registered, exceptions: b.exceptions, href: b.href }));
    default: return [];
  }
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) || /^[=+@-]/.test(s) ? `"${(/^[=+@-]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
export async function getOpeningTemplate(client, c, format = "csv") {
  requireSees(c);
  if (format === "xlsx") {
    const { buildXlsxWorkbook } = await import("../../../core/platform/data-exchange/xlsx.js");
    return { fileName: "existing-assets-template.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: buildXlsxWorkbook({ sheetName: "Existing assets", columns: COLUMNS.map((k) => ({ key: k, label: k })), rows: [EXAMPLE] }) };
  }
  return { fileName: "existing-assets-template.csv", contentType: "text/csv; charset=utf-8", body: [COLUMNS.join(","), COLUMNS.map((k) => csvCell(EXAMPLE[k] ?? "")).join(",")].join("\r\n") + "\r\n" };
}
export async function exportOpeningBatch(client, c, batchId) {
  if (!has(c, OPENING.export)) throw openingError(403, "ASSET_OPENING_PERMISSION_DENIED");
  const b = await getOpeningBatch(client, c, batchId);
  const header = ["Row", "Status", "Name", "Previous code", "Asset code", "Errors", "Warnings"];
  return { fileName: `${b.number}-rows.csv`, csv: [header, ...b.rows.map((r) => [r.row, r.statusLabel, r.name, r.existingCode, r.assetNumber, r.errors.map((e) => e.message).join(" "), r.warnings.map((w) => w.message).join(" ")])]
    .map((l) => l.map(csvCell).join(",")).join("\r\n") };
}
