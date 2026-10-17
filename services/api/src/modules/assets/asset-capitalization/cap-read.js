// Assets — Purchase and Capitalization, the reads: the acquisition pipeline (purchases to register, assets with cost pending, Finance's
// review queue, capitalized assets, CWIP, adjustments), each request with its components and journal, the asset's capitalization panel,
// the quantity-and-value reconciliation of every source line, exceptions, reports and the export. Amounts only with a cost permission.
import { has, qx, uuid } from "../common.js";
import { ADJUSTMENT_KIND, ADJUSTMENT_STATUS, CAP, CAP_STATUS, COMPONENT, CWIP_STATUS, TREATMENT, capError, centsText, dayOfDb, seesAcquisitions, seesCost, toCents } from "./cap-rules.js";
import { billLine, computeProposal, loadCapAsset } from "./cap-commands.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
const requireSees = (c) => { if (!seesAcquisitions(c)) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED"); };
const money = (c, v) => (seesCost(c) ? (v === null || v === undefined ? null : String(v)) : undefined);
const idOf = (v, label) => { try { return uuid(v, label); } catch { throw capError(404, "ASSET_CAPITALIZATION_NOT_FOUND"); } };
async function accountNames(client, c, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, code, name FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, list])).rows.map((r) => [r.id, `${r.code} · ${r.name}`]));
}
const CAP_LIST = `SELECT k.*, a.asset_number, a.name AS asset_name, a.lifecycle_status, p.cwip_number, p.name AS cwip_name, ${NAME("rq")} AS requested_by_name, ${NAME("ap")} AS approved_by_name, ${NAME("po")} AS posted_by_name
  FROM tenant.asset_capitalizations k LEFT JOIN tenant.assets a ON a.id = k.asset_id LEFT JOIN tenant.asset_cwip_projects p ON p.id = k.cwip_id
  LEFT JOIN public.users rq ON rq.id = k.requested_by LEFT JOIN public.users ap ON ap.id = k.approved_by LEFT JOIN public.users po ON po.id = k.posted_by`;
function capOf(c, r) {
  return { id: r.id, number: `CAP-${r.capitalization_number}`, target: r.asset_id ? `${r.asset_number} · ${r.asset_name}` : `CWIP-${r.cwip_number} · ${r.cwip_name}`, assetId: r.asset_id, cwipId: r.cwip_id,
    targetHref: r.asset_id ? `/assets/register/${r.asset_id}?tab=financials` : `/assets/capitalization/cwip/${r.cwip_id}`, status: r.status, statusLabel: CAP_STATUS[r.status], treatment: r.treatment, treatmentLabel: TREATMENT[r.treatment],
    total: money(c, r.proposed_amount), currency: r.currency, capitalizationDate: dayOfDb(r.capitalization_date), availableForUseDate: dayOfDb(r.available_for_use_date), depreciationStartDate: dayOfDb(r.depreciation_start_date),
    taxReview: r.tax_review, requestedBy: r.requested_by_name ?? null, requestedAt: r.requested_at, approvedBy: r.approved_by_name ?? null, approvedAt: r.approved_at, postedBy: r.posted_by_name ?? null, postedAt: r.posted_at,
    journalEntryId: r.journal_entry_id, outcome: r.accounting_outcome, version: r.row_version, href: `/assets/capitalization/${r.id}` };
}

// ------------------------------------------------------------------ overview and queues
export async function getAcquisitionOverview(client, c) {
  requireSees(c);
  const n = async (sql) => Number((await client.query(sql, [c.organizationId])).rows[0].n);
  const purchases = await listPurchasesToRegister(client, c, {}).catch(() => ({ rows: [] }));
  return {
    counts: {
      toRegister: purchases.rows.reduce((t, r) => t + r.available, 0),
      costPending: await n(`SELECT count(*)::int AS n FROM tenant.assets a WHERE a.organization_id = $1 AND a.capitalization_class = 'PENDING' AND a.archived_at IS NULL AND a.lifecycle_status NOT IN ('DRAFT', 'DISPOSED', 'RETIRED')
          AND NOT EXISTS (SELECT 1 FROM tenant.asset_acquisition_allocations x WHERE x.asset_id = a.id AND x.status = 'ACTIVE' AND x.source_type = 'OPENING_BALANCE')
          AND NOT EXISTS (SELECT 1 FROM tenant.asset_capitalizations k WHERE k.asset_id = a.id AND k.status NOT IN ('REJECTED', 'REVERSED'))`),
      pendingReview: await n(`SELECT count(*)::int AS n FROM tenant.asset_capitalizations WHERE organization_id = $1 AND status IN ('PENDING_REVIEW', 'CHANGES_REQUESTED')`),
      toPost: await n(`SELECT count(*)::int AS n FROM tenant.asset_capitalizations WHERE organization_id = $1 AND status IN ('APPROVED', 'POSTING', 'RECOVERY_REQUIRED')`),
      capitalizedThisMonth: await n(`SELECT count(*)::int AS n FROM tenant.asset_capitalizations WHERE organization_id = $1 AND status = 'POSTED' AND treatment = 'CAPITALIZE' AND posted_at >= date_trunc('month', now())`),
      cwipOpen: await n(`SELECT count(*)::int AS n FROM tenant.asset_cwip_projects WHERE organization_id = $1 AND status IN ('OPEN', 'READY')`),
      adjustmentsPending: await n(`SELECT count(*)::int AS n FROM tenant.asset_capitalization_adjustments WHERE organization_id = $1 AND status = 'PENDING_REVIEW'`),
      exceptions: (await getAcquisitionExceptions(client, c)).length,
    },
    cwipBalance: seesCost(c) ? String((await client.query(`SELECT COALESCE(sum(x.reporting_amount), 0) AS n FROM tenant.asset_cost_components x JOIN tenant.asset_cwip_projects p ON p.id = x.cwip_id
        WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND p.status IN ('OPEN', 'READY')`, [c.organizationId])).rows[0].n) : null,
    can: { register: has(c, CAP.register) || has(c, CAP.bulkRegister), allocate: has(c, CAP.allocate), request: has(c, CAP.request), approve: has(c, CAP.approve), post: has(c, CAP.post), cwip: has(c, CAP.cwip),
      adjust: has(c, CAP.adjust), cost: seesCost(c), export: has(c, CAP.export), audit: has(c, CAP.audit) },
  };
}
// Purchase lines with units still to register (from the Register's acquisition sources).
export async function listPurchasesToRegister(client, c, filters = {}) {
  requireSees(c);
  const { listAcquisitionSources } = await import("../asset-register/register-read.js");
  const scoped = { ...c, permissions: [...new Set([...(c.permissions ?? []), "assets.register_bulk", ...(seesCost(c) ? ["assets.view_financials"] : [])])] };
  const out = await listAcquisitionSources(client, scoped, filters);
  return { rows: out.rows.map((r) => (seesCost(c) ? r : { ...r, proposedUnitCost: undefined })) };
}
// Registered assets whose capitalization has not been requested, with what stands in the way.
export async function listCostPending(client, c) {
  requireSees(c);
  const rows = (await client.query(`SELECT a.id, a.asset_number, a.name, a.lifecycle_status, cat.name AS category, x.source_type, x.allocated_cost, x.cost_status
      FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id = a.category_id LEFT JOIN tenant.asset_acquisition_allocations x ON x.asset_id = a.id AND x.status = 'ACTIVE'
      WHERE a.organization_id = $1 AND a.capitalization_class = 'PENDING' AND a.archived_at IS NULL AND a.lifecycle_status NOT IN ('DRAFT', 'DISPOSED', 'RETIRED') AND COALESCE(x.source_type, '') <> 'OPENING_BALANCE'
        AND NOT EXISTS (SELECT 1 FROM tenant.asset_capitalizations k WHERE k.asset_id = a.id AND k.status NOT IN ('REJECTED', 'REVERSED')) ORDER BY a.asset_number LIMIT 300`, [c.organizationId])).rows;
  const out = [];
  for (const r of rows) {
    const p = await computeProposal(client, c, { assetId: r.id }).catch((e) => ({ issues: [{ code: e.code, message: e.message }], total: null }));
    out.push({ assetId: r.id, asset: `${r.asset_number} · ${r.name}`, category: r.category, lifecycle: r.lifecycle_status, source: r.source_type, costStatus: r.cost_status, total: money(c, p.total),
      ready: !p.issues.length, issues: p.issues.map((x) => x.message), href: `/assets/register/${r.id}?tab=financials` });
  }
  return { rows: out };
}
// filters: { status?: review | approved | posted | rejected | all }
export async function listCapitalizations(client, c, filters = {}) {
  requireSees(c);
  const groups = { review: "('PENDING_REVIEW', 'CHANGES_REQUESTED', 'DRAFT')", approved: "('APPROVED', 'POSTING', 'RECOVERY_REQUIRED')", posted: "('POSTED')", rejected: "('REJECTED', 'REVERSED')" };
  const where = groups[filters.status] ? `AND k.status IN ${groups[filters.status]}` : "";
  return { rows: (await qx(client, `${CAP_LIST} WHERE k.organization_id = $1 ${where} ORDER BY k.requested_at DESC LIMIT 500`, [c.organizationId])).rows.map((r) => capOf(c, r)) };
}
export async function getCapitalization(client, c, capId) {
  requireSees(c);
  const r = (await qx(client, `${CAP_LIST} WHERE k.organization_id = $1 AND k.id = $2`, [c.organizationId, idOf(capId, "Capitalization")])).rows[0];
  if (!r) throw capError(404, "ASSET_CAPITALIZATION_NOT_FOUND");
  const names = await accountNames(client, c, [r.debit_account_id, ...(r.journal_lines ?? []).map((l) => l.accountId), ...(r.components ?? []).map((x) => x.offsetAccountId)]);
  const live = ["PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED"].includes(r.status);
  const events = (await client.query(`SELECT e.*, ${NAME("u")} AS actor FROM tenant.asset_capitalization_events e LEFT JOIN public.users u ON u.id = e.actor_user_id WHERE e.capitalization_id = $1 ORDER BY e.occurred_at DESC`, [r.id])).rows;
  return {
    ...capOf(c, r), note: r.note, reviewNote: r.review_note, rejectionReason: r.rejection_reason, reversalReason: r.reversal_reason,
    components: seesCost(c) ? (r.components ?? []).map((x) => ({ ...x, label: COMPONENT[x.component] ?? x.component, account: names.get(x.offsetAccountId) ?? null })) : [],
    journal: seesCost(c) ? (r.journal_lines ?? []).map((l) => ({ ...l, account: names.get(l.accountId) ?? l.accountId })) : [],
    debitAccount: names.get(r.debit_account_id) ?? null,
    events: events.map((e) => ({ id: e.id, action: e.action, details: e.details, reason: e.reason, by: e.actor, at: e.occurred_at })),
    can: {
      approve: r.status === "PENDING_REVIEW" && has(c, CAP.approve) && r.requested_by !== c.userId, sendBack: r.status === "PENDING_REVIEW" && (has(c, CAP.review) || has(c, CAP.approve)),
      reject: live && has(c, CAP.approve), resubmit: r.status === "CHANGES_REQUESTED" && has(c, CAP.request), post: r.status === "APPROVED" && has(c, CAP.post),
      recover: ["POSTING", "RECOVERY_REQUIRED"].includes(r.status) && (has(c, CAP.post) || has(c, CAP.reconcile)), reverse: r.status === "POSTED" && r.treatment !== "TRACKED_EXPENSED" && has(c, CAP.post),
    },
  };
}
// The asset's Financials panel: its proposal (or capitalization), components, requests and adjustments.
export async function getAssetCapitalization(client, c, assetId) {
  const a = await loadCapAsset(client, c, assetId);
  if (!seesAcquisitions(c) && !has(c, "assets.view_financials")) return { visible: false };
  const cost = seesCost(c) || has(c, "assets.view_financials");
  const requests = (await qx(client, `${CAP_LIST} WHERE k.asset_id = $1 ORDER BY k.requested_at DESC`, [a.id])).rows.map((r) => capOf({ ...c, permissions: cost ? [...(c.permissions ?? []), CAP.viewCost] : c.permissions }, r));
  const components = (await client.query(`SELECT x.*, line.description AS line_description, bill.bill_number FROM tenant.asset_cost_components x LEFT JOIN tenant.accounting_vendor_bill_lines line ON line.id = x.source_line_id
      LEFT JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id WHERE x.asset_id = $1 ORDER BY x.component_number`, [a.id])).rows;
  const adjustments = (await client.query(`SELECT * FROM tenant.asset_capitalization_adjustments WHERE asset_id = $1 ORDER BY requested_at DESC`, [a.id])).rows;
  const live = requests.find((r) => !["REJECTED", "REVERSED"].includes(r.status));
  const proposal = a.capitalization_class === "PENDING" && !live && cost ? await computeProposal(client, c, { assetId: a.id }).catch(() => null) : null;
  return {
    visible: true, assetId: a.id, capitalizationClass: a.capitalization_class, lifecycle: a.lifecycle_status, capitalizationDate: dayOfDb(a.capitalization_date), depreciationStartDate: dayOfDb(a.depreciation_start_date),
    availableForUseDate: dayOfDb(a.placed_in_service_date), capitalizedCost: cost && a.capitalization_class === "CAPITALIZED" ? String(a.capitalized_cost) : null,
    proposal: proposal ? { total: proposal.total, currency: proposal.currency, issues: proposal.issues, taxReview: proposal.taxReview, components: proposal.components.map((x) => ({ ...x, label: COMPONENT[x.component] })) } : null,
    requests,
    components: cost ? components.map((x) => ({ id: x.id, component: x.component, label: COMPONENT[x.component], amount: String(x.amount), reporting: String(x.reporting_amount), currency: x.currency, method: x.method,
      source: x.bill_number ? `${x.bill_number} · ${x.line_description}` : x.source_type === "CWIP" ? "Capital work in progress" : x.reason, status: x.status, capitalized: Boolean(x.capitalization_id), reason: x.reversal_reason ?? x.reason })) : [],
    adjustments: cost ? adjustments.map((d) => ({ id: d.id, number: `ADJ-${d.adjustment_number}`, kind: d.kind, kindLabel: ADJUSTMENT_KIND[d.kind], amount: String(d.amount), status: d.status, statusLabel: ADJUSTMENT_STATUS[d.status], reason: d.reason, at: d.requested_at })) : [],
    can: {
      request: a.capitalization_class === "PENDING" && !live && has(c, CAP.request), allocate: a.capitalization_class === "PENDING" && has(c, CAP.allocate),
      adjust: a.capitalization_class === "CAPITALIZED" && has(c, CAP.adjust), startDepreciation: a.capitalization_class === "CAPITALIZED" && !a.depreciation_start_date && a.lifecycle_status === "ACTIVE" && has(c, CAP.approve),
      returnToSupplier: a.capitalization_class !== "CAPITALIZED" && !["RETIRED", "DISPOSED"].includes(a.lifecycle_status) && (has(c, CAP.register) || has(c, CAP.bulkRegister)),
    },
    note: "Registering, capitalizing and commissioning are separate: depreciation starts when Finance sets it, never on the purchase date.",
  };
}
// Supplier bill lines with cost (or tax) still to allocate — for the allocation dialog.
export async function listCostSources(client, c, filters = {}) {
  if (!has(c, CAP.allocate) && !has(c, CAP.cwip)) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED");
  const search = String(filters.search ?? "").slice(0, 100);
  const rows = (await client.query(`SELECT line.id, bill.bill_number, bill.status, to_char(bill.bill_date, 'YYYY-MM-DD') AS date, line.description, line.net_amount, line.tax_amount, btrim(bill.currency_code) AS currency, party.display_name AS supplier,
        (SELECT COALESCE(sum(abs(amount)), 0) FROM tenant.asset_cost_components x WHERE x.source_line_id = line.id AND x.source_type = 'SUPPLIER_INVOICE_LINE' AND x.status = 'ACTIVE')
          + (SELECT COALESCE(sum(allocated_cost), 0) FROM tenant.asset_acquisition_allocations y WHERE y.source_line_id = line.id AND y.status = 'ACTIVE') AS used,
        (SELECT COALESCE(sum(abs(amount)), 0) FROM tenant.asset_cost_components x WHERE x.source_line_id = line.id AND x.source_type = 'SUPPLIER_INVOICE_TAX' AND x.status = 'ACTIVE') AS tax_used
      FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id LEFT JOIN tenant.business_parties party ON party.id = bill.party_id
      WHERE line.organization_id = $1 AND bill.bill_type = 'bill' AND bill.status IN ('approved', 'posted', 'partially_paid', 'paid', 'overdue', 'disputed')
        AND ($2 = '' OR bill.bill_number ILIKE '%' || $2 || '%' OR line.description ILIKE '%' || $2 || '%' OR party.display_name ILIKE '%' || $2 || '%')
      ORDER BY bill.bill_date DESC, line.sequence LIMIT 300`, [c.organizationId, search])).rows;
  return { rows: rows.map((r) => ({ sourceLineId: r.id, document: r.bill_number, date: r.date, description: r.description, supplier: r.supplier, currency: r.currency, posted: r.status !== "approved",
    net: String(r.net_amount), remaining: centsText(toCents(r.net_amount) - toCents(r.used)), tax: String(r.tax_amount), taxRemaining: centsText(toCents(r.tax_amount) - toCents(r.tax_used)) }))
    .filter((r) => toCents(r.remaining) > 0n || toCents(r.taxRemaining) > 0n) };
}

// ------------------------------------------------------------------ CWIP
export async function listCwipProjects(client, c) {
  requireSees(c);
  const rows = (await client.query(`SELECT p.*, cat.name AS category, (SELECT COALESCE(sum(reporting_amount), 0) FROM tenant.asset_cost_components x WHERE x.cwip_id = p.id AND x.status = 'ACTIVE') AS balance,
      (SELECT COALESCE(sum(reporting_amount), 0) FROM tenant.asset_cost_components x WHERE x.source_cwip_id = p.id AND x.status = 'ACTIVE') AS transferred,
      (SELECT status FROM tenant.asset_capitalizations k WHERE k.cwip_id = p.id AND k.status NOT IN ('REJECTED', 'REVERSED') LIMIT 1) AS cap_status
      FROM tenant.asset_cwip_projects p LEFT JOIN tenant.asset_categories cat ON cat.id = p.category_id WHERE p.organization_id = $1 ORDER BY p.created_at DESC LIMIT 300`, [c.organizationId])).rows;
  return { rows: rows.map((p) => ({ id: p.id, number: `CWIP-${p.cwip_number}`, name: p.name, category: p.category, status: p.status, statusLabel: CWIP_STATUS[p.status], readyAt: dayOfDb(p.ready_at),
    balance: money(c, p.balance), transferred: money(c, p.transferred), capitalization: p.cap_status ? CAP_STATUS[p.cap_status] : null, ageDays: Math.floor((Date.now() - new Date(p.created_at).getTime()) / 864e5), href: `/assets/capitalization/cwip/${p.id}` })) };
}
export async function getCwipProject(client, c, cwipId) {
  requireSees(c);
  const p = (await client.query(`SELECT p.*, cat.name AS category, cat.cwip_account_id AS category_cwip FROM tenant.asset_cwip_projects p LEFT JOIN tenant.asset_categories cat ON cat.id = p.category_id
      WHERE p.organization_id = $1 AND p.id = $2`, [c.organizationId, idOf(cwipId, "CWIP project")])).rows[0];
  if (!p) throw capError(404, "ASSET_CAPITALIZATION_NOT_FOUND", "That CWIP project was not found.");
  const costs = (await client.query(`SELECT x.*, line.description AS line_description, bill.bill_number FROM tenant.asset_cost_components x LEFT JOIN tenant.accounting_vendor_bill_lines line ON line.id = x.source_line_id
      LEFT JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id WHERE x.cwip_id = $1 ORDER BY x.component_number`, [p.id])).rows;
  const transfers = (await client.query(`SELECT x.*, a.asset_number, a.name FROM tenant.asset_cost_components x JOIN tenant.assets a ON a.id = x.asset_id WHERE x.source_cwip_id = $1 ORDER BY x.component_number`, [p.id])).rows;
  const cap = (await qx(client, `${CAP_LIST} WHERE k.cwip_id = $1 ORDER BY k.requested_at DESC`, [p.id])).rows.map((r) => capOf(c, r));
  const balance = costs.filter((x) => x.status === "ACTIVE").reduce((t, x) => t + toCents(x.reporting_amount), 0n);
  const moved = transfers.filter((x) => x.status === "ACTIVE").reduce((t, x) => t + toCents(x.reporting_amount), 0n);
  const posted = cap.find((k) => k.status === "POSTED");
  const live = cap.find((k) => !["REJECTED", "REVERSED"].includes(k.status));
  const names = await accountNames(client, c, [p.cwip_account_id ?? p.category_cwip]);
  return {
    id: p.id, number: `CWIP-${p.cwip_number}`, name: p.name, description: p.description, category: p.category, status: p.status, statusLabel: CWIP_STATUS[p.status], readyAt: dayOfDb(p.ready_at), readyEvidence: p.ready_evidence,
    account: names.get(p.cwip_account_id ?? p.category_cwip) ?? null, balance: money(c, centsText(balance)), transferred: money(c, centsText(moved)), remaining: money(c, centsText(balance - moved)),
    costs: seesCost(c) ? costs.map((x) => ({ id: x.id, component: x.component, label: COMPONENT[x.component], amount: String(x.amount), reporting: String(x.reporting_amount), source: x.bill_number ? `${x.bill_number} · ${x.line_description}` : x.reason, status: x.status, capitalized: Boolean(x.capitalization_id) })) : [],
    transfers: transfers.map((x) => ({ id: x.id, assetId: x.asset_id, asset: `${x.asset_number} · ${x.name}`, amount: money(c, x.reporting_amount), status: x.status })),
    capitalizations: cap,
    can: { addCost: p.status === "OPEN" && !posted && !live && (has(c, CAP.allocate) || has(c, CAP.cwip)), ready: p.status === "OPEN" && has(c, CAP.cwip), request: !live && p.status !== "CANCELLED" && balance > 0n && has(c, CAP.request),
      transfer: p.status === "READY" && Boolean(posted) && has(c, CAP.cwip) },
  };
}
export async function listCapitalizationAdjustments(client, c, filters = {}) {
  requireSees(c);
  const where = filters.status === "pending" ? "AND d.status = 'PENDING_REVIEW'" : "";
  const rows = (await client.query(`SELECT d.*, a.asset_number, a.name, ${NAME("u")} AS requester FROM tenant.asset_capitalization_adjustments d JOIN tenant.assets a ON a.id = d.asset_id LEFT JOIN public.users u ON u.id = d.requested_by
      WHERE d.organization_id = $1 ${where} ORDER BY d.requested_at DESC LIMIT 500`, [c.organizationId])).rows;
  return { rows: rows.map((d) => ({ id: d.id, number: `ADJ-${d.adjustment_number}`, assetId: d.asset_id, asset: `${d.asset_number} · ${d.name}`, kind: d.kind, kindLabel: ADJUSTMENT_KIND[d.kind], amount: money(c, d.amount),
    status: d.status, statusLabel: ADJUSTMENT_STATUS[d.status], reason: d.reason, evidence: d.evidence, requestedBy: d.requester, at: d.requested_at, mine: d.requested_by === c.userId,
    canDecide: d.status === "PENDING_REVIEW" && has(c, CAP.post) && d.requested_by !== c.userId })) };
}

// ------------------------------------------------------------------ reconciliation and exceptions
// Every source line used by an asset: units received vs registered, value vs allocated, capitalized vs posted.
export async function getAcquisitionReconciliation(client, c) {
  if (!has(c, CAP.reconcile) && !seesCost(c)) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED");
  const rows = (await client.query(`WITH used AS (
        SELECT source_line_id AS line_id, sum(allocated_quantity) AS units, COALESCE(sum(allocated_cost), 0) AS purchase, count(DISTINCT asset_id) AS assets FROM tenant.asset_acquisition_allocations
         WHERE organization_id = $1 AND status = 'ACTIVE' AND source_line_id IS NOT NULL GROUP BY 1
        UNION ALL SELECT source_line_id, 0, 0, 0 FROM tenant.asset_cost_components WHERE organization_id = $1 AND status = 'ACTIVE' AND source_line_id IS NOT NULL GROUP BY 1),
      lines AS (SELECT line_id, sum(units) AS units, sum(purchase) AS purchase FROM used GROUP BY 1)
      SELECT l.line_id, l.units, l.purchase, bl.description AS bill_desc, bl.quantity AS bill_qty, bl.net_amount, bl.tax_amount, b.bill_number, b.bill_type, gl.description AS grn_desc, COALESCE(gl.base_quantity, gl.accepted_quantity) AS grn_qty, g.receipt_number,
        (SELECT COALESCE(sum(abs(amount)), 0) FROM tenant.asset_cost_components x WHERE x.source_line_id = l.line_id AND x.source_type = 'SUPPLIER_INVOICE_LINE' AND x.status = 'ACTIVE') AS extra,
        (SELECT COALESCE(sum(abs(amount)), 0) FROM tenant.asset_cost_components x WHERE x.source_line_id = l.line_id AND x.source_type = 'SUPPLIER_INVOICE_TAX' AND x.status = 'ACTIVE') AS tax_used
      FROM lines l LEFT JOIN tenant.accounting_vendor_bill_lines bl ON bl.id = l.line_id LEFT JOIN tenant.accounting_vendor_bills b ON b.id = bl.vendor_bill_id
      LEFT JOIN tenant.goods_receipt_lines gl ON gl.id = l.line_id LEFT JOIN tenant.goods_receipts g ON g.id = gl.goods_receipt_id ORDER BY 8, 12 LIMIT 1000`, [c.organizationId])).rows;
  const lines = rows.map((r) => {
    const qty = Number(r.bill_qty ?? r.grn_qty ?? 0);
    const units = Number(r.units);
    const value = r.net_amount === null ? null : toCents(r.net_amount);
    const allocated = toCents(r.purchase) + toCents(r.extra);
    return { sourceLineId: r.line_id, document: r.bill_number ?? r.receipt_number, kind: r.bill_number ? (r.bill_type === "credit_note" ? "Supplier credit note" : "Supplier bill") : "Goods receipt", description: r.bill_desc ?? r.grn_desc,
      quantity: qty, registered: units, remainingUnits: units > 0 ? Math.max(0, qty - units) : null, value: value === null ? null : money(c, centsText(value)), allocated: money(c, centsText(allocated)),
      remainingValue: value === null ? null : money(c, centsText(value - allocated)), taxAllocated: money(c, String(r.tax_used)), fullyRegistered: units > 0 && units >= qty, overAllocated: value !== null && allocated > value };
  });
  const caps = (await client.query(`SELECT count(*) FILTER (WHERE status = 'APPROVED')::int AS approved, count(*) FILTER (WHERE status = 'POSTED' AND treatment IN ('CAPITALIZE', 'CWIP'))::int AS posted,
      count(*) FILTER (WHERE status = 'POSTED' AND treatment IN ('CAPITALIZE', 'CWIP') AND journal_entry_id IS NULL AND accounting_outcome = 'POSTED')::int AS unlinked,
      COALESCE(sum(proposed_amount) FILTER (WHERE status = 'POSTED' AND treatment = 'CAPITALIZE'), 0) AS capitalized FROM tenant.asset_capitalizations WHERE organization_id = $1`, [c.organizationId])).rows[0];
  const cwip = (await listCwipProjects(client, c)).rows;
  return { lines, capitalizations: { approvedNotPosted: caps.approved, posted: caps.posted, postedWithoutJournal: caps.unlinked, capitalizedValue: money(c, caps.capitalized) },
    cwip: cwip.map((p) => ({ number: p.number, name: p.name, status: p.statusLabel, balance: p.balance, transferred: p.transferred, href: p.href })),
    note: "A line is fully registered only when every unit has its asset; allocated value never exceeds the line." };
}
export async function getAcquisitionExceptions(client, c) {
  requireSees(c);
  const out = [];
  const q = async (sql) => (await client.query(sql, [c.organizationId])).rows;
  for (const r of await q(`SELECT a.id, a.asset_number, a.name FROM tenant.assets a WHERE a.organization_id = $1 AND a.capitalization_class = 'PENDING' AND a.archived_at IS NULL AND a.lifecycle_status IN ('REGISTERED', 'ACTIVE', 'ON_HOLD')
      AND NOT EXISTS (SELECT 1 FROM tenant.asset_acquisition_allocations x WHERE x.asset_id = a.id AND x.status = 'ACTIVE') AND NOT EXISTS (SELECT 1 FROM tenant.asset_cost_components x WHERE x.asset_id = a.id AND x.status = 'ACTIVE') ORDER BY 2 LIMIT 200`)) {
    out.push({ kind: "NO_SOURCE", label: "Registered without a validated acquisition source", subject: `${r.asset_number} · ${r.name}`, href: `/assets/register/${r.id}?tab=acquisition` });
  }
  for (const r of await q(`SELECT a.id, a.asset_number, a.name FROM tenant.assets a WHERE a.organization_id = $1 AND a.capitalization_class = 'CAPITALIZED' AND a.archived_at IS NULL AND a.capitalization_journal_id IS NULL
      AND a.accounting_status = 'posted' ORDER BY 2 LIMIT 200`)) out.push({ kind: "NO_POSTING_LINK", label: "Capitalized without a Finance posting link", subject: `${r.asset_number} · ${r.name}`, href: `/assets/register/${r.id}?tab=financials` });
  for (const r of await q(`SELECT a.id, a.asset_number, a.name FROM tenant.assets a WHERE a.organization_id = $1 AND a.capitalization_class = 'CAPITALIZED' AND a.lifecycle_status = 'ACTIVE' AND a.depreciation_start_date IS NULL
      AND COALESCE(a.depreciation_method, 'none') <> 'none' ORDER BY 2 LIMIT 200`)) out.push({ kind: "NO_DEPRECIATION", label: "Capitalized and in use, depreciation start not set", subject: `${r.asset_number} · ${r.name}`, href: `/assets/register/${r.id}?tab=financials` });
  for (const r of await q(`SELECT k.id, k.capitalization_number FROM tenant.asset_capitalizations k WHERE k.organization_id = $1 AND k.status IN ('POSTING', 'RECOVERY_REQUIRED')`)) {
    out.push({ kind: "RECOVERY", label: "Posting outcome being verified", subject: `CAP-${r.capitalization_number}`, href: `/assets/capitalization/${r.id}` });
  }
  for (const r of await q(`SELECT k.id, k.capitalization_number FROM tenant.asset_capitalizations k WHERE k.organization_id = $1 AND k.status = 'PENDING_REVIEW' AND k.tax_review`)) {
    out.push({ kind: "TAX_REVIEW", label: "Purchase tax treatment to verify", subject: `CAP-${r.capitalization_number}`, href: `/assets/capitalization/${r.id}` });
  }
  for (const r of await q(`SELECT p.id, p.cwip_number, p.name, p.status FROM tenant.asset_cwip_projects p WHERE p.organization_id = $1 AND ((p.status = 'READY' AND p.updated_at < now() - interval '30 days') OR (p.status = 'OPEN' AND p.created_at < now() - interval '180 days'))`)) {
    out.push({ kind: "CWIP_UNRESOLVED", label: r.status === "READY" ? "CWIP ready but not transferred" : "CWIP open for over six months", subject: `CWIP-${r.cwip_number} · ${r.name}`, href: `/assets/capitalization/cwip/${r.id}` });
  }
  // Supplier credits against a purchase whose assets are capitalized, not yet applied.
  for (const r of await q(`SELECT DISTINCT line.id, bill.bill_number, a.id AS asset_id, a.asset_number FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id
      JOIN tenant.asset_acquisition_allocations x ON x.root_po_line_id = line.purchase_order_line_id AND x.status = 'ACTIVE' JOIN tenant.assets a ON a.id = x.asset_id AND a.capitalization_class = 'CAPITALIZED'
      WHERE line.organization_id = $1 AND bill.bill_type = 'credit_note' AND bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')
        AND NOT EXISTS (SELECT 1 FROM tenant.asset_capitalization_adjustments d WHERE d.source_line_id = line.id AND d.status <> 'REJECTED') LIMIT 200`)) {
    out.push({ kind: "CREDIT_NOTE", label: "Supplier credit note awaiting reconciliation", subject: `${r.bill_number} → ${r.asset_number}`, href: `/assets/register/${r.asset_id}?tab=financials` });
  }
  const rec = has(c, CAP.reconcile) || seesCost(c) ? (await getAcquisitionReconciliation(client, c)).lines.filter((l) => l.overAllocated) : [];
  for (const l of rec) out.push({ kind: "OVER_ALLOCATED", label: "Source allocated above its value", subject: `${l.document} · ${l.description}`, href: "/assets/capitalization?view=reconciliation" });
  return out;
}

// ------------------------------------------------------------------ reports, history, export
export const CAP_REPORTS = Object.freeze(["purchases-pending-registration", "pending-capitalization", "capitalized-by-period", "acquisitions-by-category", "acquisitions-by-supplier", "cost-allocation-detail",
  "purchase-source-reconciliation", "cwip-summary", "cwip-aging", "capitalization-adjustments", "tracked-only-purchases", "acquisition-tax-exceptions", "missing-depreciation-policies", "purchase-to-asset-audit"]);
const COST_REPORTS = ["capitalized-by-period", "acquisitions-by-category", "acquisitions-by-supplier", "cost-allocation-detail", "capitalization-adjustments"];
export async function getCapitalizationReport(client, c, kind) {
  if (!CAP_REPORTS.includes(kind)) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Unknown report.");
  requireSees(c);
  if (COST_REPORTS.includes(kind) && !seesCost(c)) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED");
  const q = async (sql) => (await client.query(sql, [c.organizationId])).rows;
  switch (kind) {
    case "purchases-pending-registration": return (await listPurchasesToRegister(client, c, {})).rows.map((r) => ({ document: r.document, description: r.description, supplier: r.supplier, quantity: r.quantity, registered: r.registered, remaining: r.available }));
    case "pending-capitalization": return (await listCostPending(client, c)).rows.map((r) => ({ asset: r.asset, category: r.category, ready: r.ready ? "Ready to request" : r.issues.join(" "), href: r.href }));
    case "capitalized-by-period": return (await q(`SELECT to_char(k.capitalization_date, 'YYYY-MM') AS period, count(*)::int AS assets, sum(k.proposed_amount) AS amount FROM tenant.asset_capitalizations k
        WHERE k.organization_id = $1 AND k.status = 'POSTED' AND k.treatment = 'CAPITALIZE' GROUP BY 1 ORDER BY 1 DESC`)).map((r) => ({ period: r.period, assets: r.assets, amount: String(r.amount) }));
    case "acquisitions-by-category": return (await q(`SELECT cat.name AS category, count(*)::int AS assets, COALESCE(sum(a.capitalized_cost) FILTER (WHERE a.capitalization_class = 'CAPITALIZED'), 0) AS capitalized
        FROM tenant.asset_acquisition_allocations x JOIN tenant.assets a ON a.id = x.asset_id JOIN tenant.asset_categories cat ON cat.id = a.category_id WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.source_type NOT IN ('OPENING_BALANCE')
        GROUP BY 1 ORDER BY 2 DESC`)).map((r) => ({ category: r.category, assets: r.assets, capitalized: String(r.capitalized) }));
    case "acquisitions-by-supplier": return (await q(`SELECT COALESCE(party.display_name, '—') AS supplier, count(*)::int AS assets, COALESCE(sum(x.allocated_cost), 0) AS purchase FROM tenant.asset_acquisition_allocations x
        JOIN tenant.assets a ON a.id = x.asset_id LEFT JOIN tenant.business_parties party ON party.id = a.supplier_id WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.source_type NOT IN ('OPENING_BALANCE') GROUP BY 1 ORDER BY 2 DESC`))
      .map((r) => ({ supplier: r.supplier, assets: r.assets, purchaseValue: String(r.purchase) }));
    case "cost-allocation-detail": return (await q(`SELECT a.id, a.asset_number, x.component, x.method, x.amount, x.reporting_amount, x.status, bill.bill_number, line.description FROM tenant.asset_cost_components x JOIN tenant.assets a ON a.id = x.asset_id
        LEFT JOIN tenant.accounting_vendor_bill_lines line ON line.id = x.source_line_id LEFT JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id WHERE x.organization_id = $1 ORDER BY a.asset_number, x.component_number LIMIT 2000`))
      .map((r) => ({ asset: r.asset_number, component: COMPONENT[r.component], method: r.method.toLowerCase(), amount: String(r.reporting_amount), source: r.bill_number ? `${r.bill_number} · ${r.description}` : "—", status: r.status === "ACTIVE" ? "Active" : "Reversed", href: `/assets/register/${r.id}?tab=financials` }));
    case "purchase-source-reconciliation": return (await getAcquisitionReconciliation(client, c)).lines.map((l) => ({ document: l.document, description: l.description, quantity: l.quantity, registered: l.registered, remainingUnits: l.remainingUnits ?? "—",
      ...(seesCost(c) ? { value: l.value ?? "—", allocated: l.allocated, remainingValue: l.remainingValue ?? "—" } : {}) }));
    case "cwip-summary": return (await listCwipProjects(client, c)).rows.map((p) => ({ cwip: p.number, name: p.name, status: p.statusLabel, ...(seesCost(c) ? { balance: p.balance, transferred: p.transferred } : {}), href: p.href }));
    case "cwip-aging": return (await listCwipProjects(client, c)).rows.filter((p) => ["Accumulating cost", "Ready for use — to transfer"].includes(p.statusLabel)).map((p) => ({ cwip: p.number, name: p.name, status: p.statusLabel, ageDays: p.ageDays, href: p.href }));
    case "capitalization-adjustments": return (await listCapitalizationAdjustments(client, c, {})).rows.map((d) => ({ adjustment: d.number, asset: d.asset, kind: d.kindLabel, amount: d.amount, status: d.statusLabel, href: `/assets/register/${d.assetId}?tab=financials` }));
    case "tracked-only-purchases": return (await q(`SELECT a.id, a.asset_number, a.name, cat.name AS category FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id = a.category_id
        WHERE a.organization_id = $1 AND a.capitalization_class = 'TRACKED_ONLY' AND a.acquisition_method = 'PURCHASE' AND a.archived_at IS NULL ORDER BY 2`)).map((r) => ({ asset: `${r.asset_number} · ${r.name}`, category: r.category, href: `/assets/register/${r.id}` }));
    case "acquisition-tax-exceptions": return (await getAcquisitionExceptions(client, c)).filter((e) => e.kind === "TAX_REVIEW").map((e) => ({ capitalization: e.subject, issue: e.label, href: e.href }));
    case "missing-depreciation-policies": return (await getAcquisitionExceptions(client, c)).filter((e) => e.kind === "NO_DEPRECIATION").map((e) => ({ asset: e.subject, issue: e.label, href: e.href }));
    case "purchase-to-asset-audit": return (await getCapitalizationHistory(client, c, {})).map((e) => ({ when: e.at, action: e.actionLabel, asset: e.asset ?? "—", by: e.by ?? "—", reason: e.reason ?? "" }));
    default: return [];
  }
}
const EVENT_LABEL = Object.freeze({ COST_ALLOCATED: "Cost allocated", COST_REVERSED: "Allocation reversed", REQUESTED: "Capitalization requested", CHANGES_REQUESTED: "Sent back for changes", RESUBMITTED: "Resubmitted",
  REJECTED: "Rejected", NOT_ELIGIBLE: "Not eligible", EXPENSED: "Expensed (tracked only)", APPROVED: "Approved", POSTED: "Posted", POSTING_RECOVERED: "Posting recovered", POSTING_NOT_FOUND: "Posting not found — back to approved",
  REVERSED: "Reversed", DEPRECIATION_START_SET: "Depreciation start set", CWIP_CREATED: "CWIP project started", CWIP_READY: "CWIP ready for use", CWIP_TRANSFERRED: "Transferred from CWIP",
  ADJUSTMENT_REQUESTED: "Adjustment requested", ADJUSTMENT_POSTED: "Adjustment posted", ADJUSTMENT_REJECTED: "Adjustment rejected", RETURNED: "Returned to supplier" });
export async function getCapitalizationHistory(client, c, filters = {}) {
  if (!has(c, CAP.audit) && !has(c, CAP.approve)) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED");
  const values = [c.organizationId];
  let where = "";
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where = `AND e.asset_id = $${values.length}`; }
  return (await client.query(`SELECT e.*, ${NAME("u")} AS actor, a.asset_number FROM tenant.asset_capitalization_events e LEFT JOIN public.users u ON u.id = e.actor_user_id LEFT JOIN tenant.assets a ON a.id = e.asset_id
      WHERE e.organization_id = $1 ${where} ORDER BY e.occurred_at DESC LIMIT 1000`, values)).rows
    .map((e) => ({ id: e.id, action: e.action, actionLabel: EVENT_LABEL[e.action] ?? e.action, asset: e.asset_number, assetId: e.asset_id, capitalizationId: e.capitalization_id, details: e.details, reason: e.reason, by: e.actor, at: e.occurred_at }));
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) || /^[=+@-]/.test(s) ? `"${(/^[=+@-]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
export async function exportCapitalizations(client, c) {
  if (!has(c, CAP.export)) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED");
  const rows = (await listCapitalizations(client, c, {})).rows;
  const header = ["Request", "Asset or CWIP", "Status", "Treatment", ...(seesCost(c) ? ["Amount", "Currency"] : []), "Capitalization date", "Available for use", "Depreciation start", "Requested by", "Approved by", "Posted at"];
  return { fileName: "capitalizations.csv", csv: [header, ...rows.map((r) => [r.number, r.target, r.statusLabel, r.treatmentLabel, ...(seesCost(c) ? [r.total, r.currency] : []), r.capitalizationDate, r.availableForUseDate,
    r.depreciationStartDate, r.requestedBy, r.approvedBy, r.postedAt])].map((l) => l.map(csvCell).join(",")).join("\r\n") };
}
export { billLine as _billLine };
