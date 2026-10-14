// Production Costing — the setup screen: the company's switches, the overhead categories (cost pools) and every labor and overhead rate
// through its lifecycle (draft, waiting for approval, in force, retired), with who set and approved it.
import { BASIS_LABEL, COMPONENT_LABEL, COST, D, costSettings, has, needCostView, q } from "./cost-core.js";
import { ensureOverheadCategories } from "./cost-service.js";

const STATUS = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Waiting for approval", ACTIVE: "In force", RETIRED: "Retired" });
const day = (value) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ?? null);

export async function listOverheadCategories(client, c) {
  needCostView(c);
  await ensureOverheadCategories(client, c);
  const rows = (await client.query(`SELECT category.*, (SELECT array_agg(account.code || ' · ' || account.name ORDER BY account.code) FROM tenant.accounting_accounts account WHERE account.id = ANY(category.cost_pool_account_ids)) AS accounts
      FROM tenant.manufacturing_overhead_categories category WHERE category.organization_id = $1 ORDER BY category.status, category.name`, [c.organizationId])).rows;
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, description: row.description, defaultBasis: row.default_basis, defaultBasisLabel: BASIS_LABEL[row.default_basis],
    costPoolAccountIds: row.cost_pool_account_ids ?? [], costPoolAccounts: row.accounts ?? [], costPoolNote: row.cost_pool_note, status: row.status }));
}
// The company's expense accounts a category's cost pool can be made of.
export async function listOverheadPoolAccounts(client, c) {
  needCostView(c);
  return (await client.query(`SELECT id, code, name FROM tenant.accounting_accounts WHERE organization_id = $1 AND account_class = 'expense' AND NOT is_group ORDER BY code`, [c.organizationId])).rows;
}
export async function listCostRates(client, c) {
  needCostView(c);
  const settings = await costSettings(client, c);
  const rows = (await client.query(`SELECT rate.*, item.code AS item_code, item.name AS item_name, category.name AS category_name, uom.code AS uom_code
      FROM tenant.manufacturing_cost_rates rate LEFT JOIN tenant.items item ON item.id = rate.finished_item_id LEFT JOIN tenant.manufacturing_overhead_categories category ON category.id = rate.category_id
      LEFT JOIN tenant.units_of_measure uom ON uom.id = rate.uom_id
      WHERE rate.organization_id = $1 ORDER BY CASE rate.status WHEN 'PENDING_APPROVAL' THEN 0 WHEN 'DRAFT' THEN 1 WHEN 'ACTIVE' THEN 2 ELSE 3 END, rate.component, category.name NULLS FIRST,
        item.code NULLS FIRST, rate.effective_from DESC LIMIT 500`, [c.organizationId])).rows;
  const ids = [...new Set(rows.flatMap((row) => [row.created_by, row.submitted_by, row.approved_by]).filter(Boolean))];
  const people = ids.length ? new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [ids])).rows.map((row) => [row.id, row.name])) : new Map();
  const manage = has(c, COST.rateManage);
  const approve = has(c, COST.rateApprove);
  return { laborEnabled: settings.LABOR, overheadEnabled: settings.OVERHEAD, selfApproval: settings.selfApproval,
    rates: rows.map((row) => ({ id: row.id, code: row.rate_code, name: row.name, component: row.component, componentLabel: COMPONENT_LABEL[row.component], categoryId: row.category_id, category: row.category_name,
      basis: row.basis, basisLabel: BASIS_LABEL[row.basis], rate: q(D(row.rate)), zeroReason: row.zero_reason, uom: row.uom_code, product: row.finished_item_id ? `${row.item_code} · ${row.item_name}` : null,
      productId: row.finished_item_id, effectiveFrom: day(row.effective_from), effectiveUntil: day(row.effective_until), version: row.version, status: row.status, statusLabel: STATUS[row.status],
      notes: row.notes, decisionNote: row.decision_note, rowVersion: row.row_version, createdBy: people.get(row.created_by) ?? null, approvedBy: people.get(row.approved_by) ?? null,
      createdAt: row.created_at, approvedAt: row.approved_at, retiredAt: row.retired_at,
      can: { edit: manage && row.status === "DRAFT", submit: manage && row.status === "DRAFT",
        decide: approve && row.status === "PENDING_APPROVAL" && (settings.selfApproval || ![row.created_by, row.submitted_by].includes(c.userId)),
        retire: manage && row.status !== "RETIRED" } })),
    can: { manage, approve } };
}
