// The Quality home dashboard (inspection, hold and non-conformance KPIs) and the picker options for the
// web forms.
import { needAny, qx, seq } from "./common.js";

const MANAGE = "quality.manage";
const VIEW = ["quality.view", MANAGE];

export async function getQualityKpiDashboard(client, c) {
  needAny(c, VIEW);
  const [inspections, issues] = await seq([
    () => qx(client, `SELECT count(*) FILTER (WHERE status IN ('draft','in_progress'))::int AS open_inspections, count(*) FILTER (WHERE status='failed')::int AS failed_inspections, count(*) FILTER (WHERE created_at::date=current_date)::int AS inspections_today,
        round(100.0 * count(*) FILTER (WHERE status IN ('passed','conditionally_accepted')) / NULLIF(count(*) FILTER (WHERE status IN ('passed','failed','conditionally_accepted')),0), 2) AS first_pass_yield
      FROM tenant.quality_inspections WHERE organization_id=$1`, [c.organizationId]),
    () => qx(client, `SELECT count(*) FILTER (WHERE status IN ('active','partially_resolved'))::int AS active_holds,
        (SELECT count(*)::int FROM tenant.quality_nonconformances WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED')) AS open_nonconformances,
        (SELECT count(*)::int FROM tenant.quality_nonconformances WHERE organization_id=$1 AND severity='critical' AND status NOT IN ('CLOSED','CANCELLED')) AS open_critical_nonconformances
      FROM tenant.inventory_stock_holds WHERE organization_id=$1`, [c.organizationId]),
  ]);
  return { ...inspections.rows[0], ...issues.rows[0] };
}

// ---------------------------------------------------------------- picker options for the web forms
export async function listQualityOptions(client, c) {
  needAny(c, ["quality.view", "quality.inspect", MANAGE]);
  const p = [c.organizationId];
  const [items, suppliers, warehouses, plans, nonconformances, customers] = await seq([
    () => qx(client, `SELECT id, code, name FROM tenant.items WHERE organization_id=$1 ORDER BY code LIMIT 2000`, p).catch(() => ({ rows: [] })),
    () => qx(client, `SELECT id, code, display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND party_type IN ('supplier','both') AND status='active' ORDER BY display_name LIMIT 2000`, [c.organizationId]),
    () => qx(client, `SELECT id, code, name FROM tenant.warehouses WHERE organization_id=$1 ORDER BY code LIMIT 500`, p).catch(() => ({ rows: [] })),
    () => qx(client, `SELECT p.id, COALESCE(s.specification_code || ' v' || v.version_number, p.code || ' v' || p.version) AS code, COALESCE(s.name, p.name) AS name FROM tenant.quality_plans p
      LEFT JOIN tenant.quality_inspection_spec_versions v ON v.id = p.spec_version_id LEFT JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id
      WHERE p.organization_id=$1 AND p.status='active' ORDER BY 2 LIMIT 500`, p),
    () => qx(client, `SELECT id, nonconformance_number AS code, description AS name FROM tenant.quality_nonconformances WHERE organization_id=$1 AND status NOT IN ('CLOSED','CANCELLED') ORDER BY created_at DESC LIMIT 500`, p),
    () => qx(client, `SELECT id, code, display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND party_type IN ('customer','both') AND status='active' ORDER BY display_name LIMIT 2000`, [c.organizationId]),
  ]);
  return { items: items.rows, suppliers: suppliers.rows, warehouses: warehouses.rows, plans: plans.rows, nonconformances: nonconformances.rows, customers: customers.rows };
}
