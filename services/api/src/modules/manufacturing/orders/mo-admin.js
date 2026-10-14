// Manufacturing Orders — around the orders: the options a new order needs (products with an effective BOM, warehouses, people, open sales
// orders), the Manufacturing home summary, and the Manufacturing settings (approval, tolerance and inspection policy for orders and BOMs).
import { effectiveWindowAt } from "../boms/bom-engine.js";
import { D, MO, STATUS_LABEL, ZERO, div, has, moError, mul, needMo, q, text } from "./mo-core.js";

export async function getManufacturingOrderOptions(client, c) {
  needMo(c, MO.view);
  const products = (await client.query(
    `SELECT DISTINCT item.id, item.code, item.name, item.uom_id, uom.code AS uom, item.tracking_type,
            policy.lead_time_days, policy.default_material_warehouse_id, policy.default_manufacturing_warehouse_id
       FROM tenant.manufacturing_bom_masters master JOIN tenant.items item ON item.id = master.finished_item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
       LEFT JOIN tenant.manufacturing_item_policies policy ON policy.organization_id = item.organization_id AND policy.item_id = item.id
      WHERE master.organization_id = $1 AND master.archived_at IS NULL AND item.status = 'active' ORDER BY item.code`, [c.organizationId])).rows;
  const withRevision = [];
  for (const product of products) {
    const window = await effectiveWindowAt(client, c.organizationId, product.id).catch(() => null);
    const next = (await client.query(
      `SELECT effectivity.effective_from, revision.revision_number FROM tenant.manufacturing_bom_effectivities effectivity JOIN tenant.manufacturing_bom_revisions revision ON revision.id = effectivity.revision_id
        WHERE effectivity.organization_id = $1 AND effectivity.finished_item_id = $2 AND effectivity.status = 'SCHEDULED' ORDER BY effectivity.effective_from LIMIT 1`, [c.organizationId, product.id])).rows[0];
    withRevision.push({ id: product.id, code: product.code, name: product.name, uomId: product.uom_id, uom: product.uom, trackingType: product.tracking_type,
      // The product's planning defaults (Sales Demand policy): a new order proposes these warehouses and its lead time.
      defaults: { leadTimeDays: product.lead_time_days, materialWarehouseId: product.default_material_warehouse_id, manufacturingWarehouseId: product.default_manufacturing_warehouse_id },
      effectiveRevision: window ? { id: window.revision_id, number: window.revision_number, from: window.effective_from, to: window.effective_to } : null,
      scheduledRevision: next ? { number: next.revision_number, from: next.effective_from } : null });
  }
  const warehouses = (await client.query(`SELECT id, code, name, is_default FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' ORDER BY code`, [c.organizationId])).rows;
  const people = (await client.query(
    `SELECT users.id, users.full_name FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY users.full_name LIMIT 500`, [c.organizationId])).rows;
  const salesOrders = (await client.query(
    `SELECT id, sales_order_number FROM tenant.sales_orders WHERE organization_id = $1 AND lifecycle_status NOT IN ('draft', 'cancelled', 'closed', 'completed') ORDER BY created_at DESC LIMIT 200`,
    [c.organizationId])).rows;
  return { products: withRevision, warehouses: warehouses.map(({ is_default: isDefault, ...row }) => ({ ...row, isDefault })), currentUserId: c.userId ?? null, people: people.map((row) => ({ id: row.id, name: row.full_name })), salesOrders: salesOrders.map((row) => ({ id: row.id, number: row.sales_order_number })) };
}

// The Manufacturing home: orders by state, what needs a decision, what is late, what is short, and the latest activity.
export async function getManufacturingHome(client, c) {
  needMo(c, MO.view);
  const counts = (await client.query(`SELECT status, count(*)::int AS n FROM tenant.manufacturing_orders WHERE organization_id = $1 GROUP BY status`, [c.organizationId])).rows;
  const inProgress = (await client.query(
    `SELECT mo.id, mo.mo_number, mo.status, mo.planned_base_quantity, mo.accepted_quantity, mo.planned_end_at, item.code, item.name FROM tenant.manufacturing_orders mo
       JOIN tenant.items item ON item.id = mo.finished_item_id WHERE mo.organization_id = $1 AND mo.status IN ('RELEASED', 'IN_PROGRESS', 'ON_HOLD') ORDER BY mo.planned_end_at LIMIT 12`,
    [c.organizationId])).rows;
  const overdue = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_orders WHERE organization_id = $1 AND status NOT IN ('COMPLETED', 'CANCELLED', 'DRAFT') AND planned_end_at < now()`,
    [c.organizationId])).rows[0].n;
  const pendingBoms = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_bom_revisions WHERE organization_id = $1 AND status = 'PENDING_APPROVAL'`, [c.organizationId])).rows[0].n;
  const openDemand = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_material_demands WHERE organization_id = $1 AND status IN ('OPEN', 'ACKNOWLEDGED')`, [c.organizationId])).rows[0].n;
  const awaitingInspection = (await client.query(`SELECT COALESCE(sum(pending_inspection_quantity), 0) AS n FROM tenant.manufacturing_orders WHERE organization_id = $1 AND status = 'IN_PROGRESS'`,
    [c.organizationId])).rows[0].n;
  const by = Object.fromEntries(counts.map((row) => [row.status, row.n]));
  return {
    counts: Object.fromEntries(Object.keys(STATUS_LABEL).map((status) => [status, by[status] ?? 0])), overdue, pendingBomApprovals: pendingBoms, openMaterialDemand: openDemand,
    awaitingInspection: q(D(awaitingInspection)),
    inProgress: inProgress.map((row) => ({ id: row.id, number: row.mo_number, status: row.status, statusLabel: STATUS_LABEL[row.status], item: `${row.code} · ${row.name}`,
      planned: q(D(row.planned_base_quantity)), accepted: q(D(row.accepted_quantity)), dueAt: row.planned_end_at,
      progressPct: D(row.planned_base_quantity) > ZERO ? q(div(mul(D(row.accepted_quantity), 100n * 1_000_000n), D(row.planned_base_quantity)), 0) : "0" })),
  };
}

// ------------------------------------------------------------------ settings
const SETTINGS = "bom_self_approval_allowed, bom_cost_stale_after_days, mo_self_approval_allowed, mo_variance_self_approval_allowed, mo_overproduction_tolerance_pct, mo_require_inspection, mo_partial_reservation_allowed, mo_release_with_shortages_allowed, mi_unreserved_issue_allowed, mi_excess_tolerance_pct, mc_variance_warning_pct, mc_variance_approval_pct, mc_self_approval_allowed, mo_production_material_check";
// Read with the quality-inspection policies (0120), which are written on their own.
const SETTINGS_READ = `${SETTINGS}, qi_template_required, qi_review_required, qi_deviation_allowed, qi_sample_decides_batch, ph_resume_approval_required, ph_overdue_after_hours, mv_saving_review_pct, mv_approval_value_above, mv_block_completion`;
const view = (row = {}) => ({ bomSelfApprovalAllowed: Boolean(row.bom_self_approval_allowed), bomCostStaleAfterDays: Number(row.bom_cost_stale_after_days ?? 90),
  moSelfApprovalAllowed: Boolean(row.mo_self_approval_allowed), moVarianceSelfApprovalAllowed: Boolean(row.mo_variance_self_approval_allowed),
  moOverproductionTolerancePct: q(D(row.mo_overproduction_tolerance_pct ?? 0)), moRequireInspection: Boolean(row.mo_require_inspection),
  moPartialReservationAllowed: row.mo_partial_reservation_allowed ?? true, moReleaseWithShortagesAllowed: row.mo_release_with_shortages_allowed ?? true,
  miUnreservedIssueAllowed: row.mi_unreserved_issue_allowed ?? true, miExcessTolerancePct: q(D(row.mi_excess_tolerance_pct ?? 0)),
  mcVarianceWarningPct: q(D(row.mc_variance_warning_pct ?? 2)), mcVarianceApprovalPct: q(D(row.mc_variance_approval_pct ?? 5)), mcSelfApprovalAllowed: Boolean(row.mc_self_approval_allowed),
  moProductionMaterialCheck: row.mo_production_material_check ?? "WARN",
  // Production Quality Inspection (0120).
  qiTemplateRequired: Boolean(row.qi_template_required), qiReviewRequired: Boolean(row.qi_review_required), qiDeviationAllowed: Boolean(row.qi_deviation_allowed),
  qiSampleDecidesBatch: Boolean(row.qi_sample_decides_batch),
  // Production Hold (0121).
  phResumeApprovalRequired: Boolean(row.ph_resume_approval_required), phOverdueAfterHours: Number(row.ph_overdue_after_hours ?? 24),
  // Material Consumption Variance (0122).
  mvSavingReviewPct: q(D(row.mv_saving_review_pct ?? 5)), mvApprovalValueAbove: row.mv_approval_value_above === null || row.mv_approval_value_above === undefined ? null : q(D(row.mv_approval_value_above)),
  mvBlockCompletion: Boolean(row.mv_block_completion) });

export async function getManufacturingSettings(client, c) {
  if (!has(c, "manufacturing.view")) throw moError(403, "MFG_MO_PERMISSION_DENIED");
  const row = (await client.query(`SELECT ${SETTINGS_READ} FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  return { ...view(row), canManage: has(c, MO.settings) };
}
export async function updateManufacturingSettings(client, c, input = {}) {
  needMo(c, MO.settings);
  const current = view((await client.query(`SELECT ${SETTINGS_READ} FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]);
  const flag = (key) => (input[key] === undefined ? current[key] : Boolean(input[key]));
  const tolerance = input.moOverproductionTolerancePct === undefined ? Number(current.moOverproductionTolerancePct) : Number(input.moOverproductionTolerancePct);
  if (!(tolerance >= 0 && tolerance <= 100)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "The overproduction tolerance is between 0% and 100%.");
  const stale = input.bomCostStaleAfterDays === undefined ? current.bomCostStaleAfterDays : Number(input.bomCostStaleAfterDays);
  if (!(Number.isInteger(stale) && stale >= 1 && stale <= 3650)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "A cost goes stale after 1 to 3650 days.");
  const issueTolerance = input.miExcessTolerancePct === undefined ? Number(current.miExcessTolerancePct) : Number(input.miExcessTolerancePct);
  if (!(issueTolerance >= 0 && issueTolerance <= 100)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "The issue tolerance is between 0% and 100%.");
  const materialCheck = input.moProductionMaterialCheck === undefined ? current.moProductionMaterialCheck : String(input.moProductionMaterialCheck).toUpperCase();
  if (!["WARN", "BLOCK"].includes(materialCheck)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "The production material check is WARN or BLOCK.");
  const warning = input.mcVarianceWarningPct === undefined ? Number(current.mcVarianceWarningPct) : Number(input.mcVarianceWarningPct);
  const approval = input.mcVarianceApprovalPct === undefined ? Number(current.mcVarianceApprovalPct) : Number(input.mcVarianceApprovalPct);
  if (!(warning >= 0 && approval >= warning && approval <= 1000)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "Usage variance: the approval percent is at least the warning percent (both 0% or more).");
  const values = [c.organizationId, flag("bomSelfApprovalAllowed"), stale, flag("moSelfApprovalAllowed"), flag("moVarianceSelfApprovalAllowed"), String(tolerance), flag("moRequireInspection"),
    flag("moPartialReservationAllowed"), flag("moReleaseWithShortagesAllowed"), flag("miUnreservedIssueAllowed"), String(issueTolerance), String(warning), String(approval), flag("mcSelfApprovalAllowed"), materialCheck];
  await client.query(
    `INSERT INTO tenant.manufacturing_settings (organization_id, ${SETTINGS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (organization_id) DO UPDATE SET bom_self_approval_allowed = $2, bom_cost_stale_after_days = $3, mo_self_approval_allowed = $4, mo_variance_self_approval_allowed = $5,
       mo_overproduction_tolerance_pct = $6, mo_require_inspection = $7, mo_partial_reservation_allowed = $8, mo_release_with_shortages_allowed = $9,
       mi_unreserved_issue_allowed = $10, mi_excess_tolerance_pct = $11, mc_variance_warning_pct = $12, mc_variance_approval_pct = $13, mc_self_approval_allowed = $14, mo_production_material_check = $15, updated_at = now()`, values);
  await client.query(`UPDATE tenant.manufacturing_settings SET qi_template_required = $2, qi_review_required = $3, qi_deviation_allowed = $4, qi_sample_decides_batch = $5 WHERE organization_id = $1`,
    [c.organizationId, flag("qiTemplateRequired"), flag("qiReviewRequired"), flag("qiDeviationAllowed"), flag("qiSampleDecidesBatch")]);
  const overdue = input.phOverdueAfterHours === undefined ? current.phOverdueAfterHours : Number(input.phOverdueAfterHours);
  if (!(Number.isInteger(overdue) && overdue >= 1 && overdue <= 8760)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "A hold is overdue after 1 to 8760 hours.");
  await client.query(`UPDATE tenant.manufacturing_settings SET ph_resume_approval_required = $2, ph_overdue_after_hours = $3 WHERE organization_id = $1`,
    [c.organizationId, flag("phResumeApprovalRequired"), overdue]);
  const saving = input.mvSavingReviewPct === undefined ? Number(current.mvSavingReviewPct) : Number(input.mvSavingReviewPct);
  if (!(saving >= 0 && saving <= 100)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "The saving review percent is between 0% and 100%.");
  const valueAbove = input.mvApprovalValueAbove === undefined ? current.mvApprovalValueAbove : input.mvApprovalValueAbove === null || input.mvApprovalValueAbove === "" ? null : Number(input.mvApprovalValueAbove);
  if (valueAbove !== null && !(Number(valueAbove) >= 0)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "The value threshold is zero or more.");
  await client.query(`UPDATE tenant.manufacturing_settings SET mv_saving_review_pct = $2, mv_approval_value_above = $3, mv_block_completion = $4 WHERE organization_id = $1`,
    [c.organizationId, String(saving), valueAbove === null ? null : String(valueAbove), flag("mvBlockCompletion")]);
  await client.query(`INSERT INTO tenant.manufacturing_events (organization_id, aggregate_type, aggregate_id, event_type, payload, actor_user_id) VALUES ($1,'settings',$1,'manufacturing.settings.updated',$2::jsonb,$3)`,
    [c.organizationId, JSON.stringify({ changed: Object.keys(input).map((key) => text(key, 60)) }), c.userId ?? null]);
  return getManufacturingSettings(client, c);
}
