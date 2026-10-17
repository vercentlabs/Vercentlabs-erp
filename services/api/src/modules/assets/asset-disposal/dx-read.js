// Assets — Asset Disposal, the reads: the workspace overview, cases by view, one case with each asset's snapshot, approvals, handover, sale invoice,
// Finance's carrying value and the completion checklist, the financial preview, the asset's disposal panel, the reconciliation queue,
// reports (proposed values kept apart from Finance-confirmed ones), the export and the audit.
import { has, uuid } from "../common.js";
import { financialPictureOf } from "./dx-commands.js";
import { MILESTONES, SCRAP_METHODS, milestoneOf } from "./dx-execution.js";
import { FINANCIAL_STATE, GAIN_LOSS_REPORTS, financialStateOf, getGainLossReport, journalAgrees, outcomeOf } from "./dx-financial.js";
import { CASE_STATUS, DX, EXECUTING, HANDOVER_KINDS, LEVEL_LABEL, LINE_STATUS, LIVE_LINE, REASONS, TYPE_LABEL, WITH_PROCEEDS, dayOfDb, dxError, fromPaise, seesDisposals, toPaise } from "./dx-rules.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
const idOf = (v, label) => { try { return uuid(v, label); } catch { throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND"); } };
const requireSees = (c) => { if (!seesDisposals(c)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED"); };
const money = (v) => (v === null || v === undefined ? null : fromPaise(toPaise(v)));

const VIEWS = Object.freeze({
  draft: "k.status IN ('DRAFT', 'CHANGES_REQUESTED')", approval: "k.status = 'PENDING_APPROVAL'", approved: "k.status = 'APPROVED'", handover: "k.status IN ('APPROVED', 'PENDING_HANDOVER')",
  finance: "k.status IN ('PENDING_FINANCE', 'POSTING', 'RECOVERY_REQUIRED')", completed: "k.status = 'COMPLETED'", closed: "k.status IN ('REJECTED', 'CANCELLED')",
  open: "k.status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED')",
  sales: "k.disposal_type = 'SALE' AND k.status NOT IN ('REJECTED', 'CANCELLED')", scrap: "k.disposal_type = 'SCRAP' AND k.status NOT IN ('REJECTED', 'CANCELLED')",
});
const LIST = `SELECT k.*, ${NAME("u")} AS requester, bp.display_name AS buyer, (SELECT bp2.display_name FROM tenant.procurement_suppliers s JOIN tenant.business_parties bp2 ON bp2.id = s.party_id WHERE s.id = k.recycler_supplier_id) AS recycler,
    (SELECT count(*)::int FROM tenant.asset_disposal_lines l WHERE l.case_id = k.id AND l.line_status NOT IN ('CANCELLED')) AS assets,
    (SELECT count(*)::int FROM tenant.asset_disposal_lines l WHERE l.case_id = k.id AND l.line_status = 'COMPLETED') AS disposed,
    (SELECT string_agg(a.asset_number, ', ' ORDER BY l.line_number) FROM tenant.asset_disposal_lines l JOIN tenant.assets a ON a.id = l.asset_id WHERE l.case_id = k.id AND l.line_status NOT IN ('CANCELLED')) AS asset_codes,
    (SELECT a.name FROM tenant.asset_disposal_lines l JOIN tenant.assets a ON a.id = l.asset_id WHERE l.case_id = k.id ORDER BY l.line_number LIMIT 1) AS first_asset,
    (SELECT COALESCE(sum(l.proposed_proceeds), 0) FROM tenant.asset_disposal_lines l WHERE l.case_id = k.id AND l.line_status NOT IN ('CANCELLED', 'REJECTED')) AS proposed_total,
    (SELECT count(*)::int FROM tenant.asset_disposal_exceptions x WHERE x.case_id = k.id AND x.status = 'OPEN') AS exceptions
  FROM tenant.asset_disposal_cases k LEFT JOIN public.users u ON u.id = k.requested_by LEFT JOIN tenant.business_parties bp ON bp.id = k.buyer_party_id`;
const caseRow = (k, c) => ({ id: k.id, number: k.case_number, type: k.disposal_type, typeLabel: TYPE_LABEL[k.disposal_type], status: k.status, statusLabel: CASE_STATUS[k.status],
  reasonCode: k.reason_code, reason: REASONS[k.reason_code] ?? k.reason_code, explanation: k.explanation, requestedDate: dayOfDb(k.requested_date), effectiveDate: dayOfDb(k.proposed_effective_date),
  buyer: k.buyer ?? null, buyerPartyId: k.buyer_party_id, recipient: k.recipient_name, recycler: k.recycler ?? null, recyclerSupplierId: k.recycler_supplier_id, destination: k.destination,
  relatedParty: k.related_party, bulk: k.is_bulk, assets: Number(k.assets ?? 0), disposed: Number(k.disposed ?? 0), assetCodes: k.asset_codes ?? "", firstAsset: k.first_asset ?? null,
  proposedProceeds: has(c, DX.financials) || has(c, DX.create) ? money(k.proposed_total) : null, exceptions: Number(k.exceptions ?? 0), requestedBy: k.requester ?? null, createdAt: k.created_at,
  legacy: Boolean(k.legacy_disposal_id), version: k.row_version, href: `/assets/disposals/${k.id}` });
// filters: { view?: all | open | draft | approval | approved | handover | finance | completed | closed, search?, assetId?, type? }
export async function listAssetDisposals(client, c, filters = {}) {
  requireSees(c);
  const values = [c.organizationId];
  let where = "k.organization_id = $1";
  if (VIEWS[filters.view]) where += ` AND ${VIEWS[filters.view]}`;
  if (filters.type) { values.push(String(filters.type)); where += ` AND k.disposal_type = $${values.length}`; }
  if (filters.search) { values.push(`%${String(filters.search).slice(0, 100)}%`); where += ` AND (k.case_number ILIKE $${values.length} OR EXISTS (SELECT 1 FROM tenant.asset_disposal_lines l JOIN tenant.assets a ON a.id = l.asset_id WHERE l.case_id = k.id AND (a.asset_number ILIKE $${values.length} OR a.name ILIKE $${values.length} OR a.serial_number ILIKE $${values.length})))`; }
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where += ` AND EXISTS (SELECT 1 FROM tenant.asset_disposal_lines l WHERE l.case_id = k.id AND l.asset_id = $${values.length})`; }
  const rows = (await client.query(`${LIST} WHERE ${where} ORDER BY k.created_at DESC LIMIT 500`, values)).rows;
  return { rows: rows.map((k) => caseRow(k, c)), can: { create: has(c, DX.create), bulk: has(c, DX.bulk), export: has(c, DX.export), reconcile: has(c, DX.reconcile) } };
}
async function eventsOf(client, c, caseId) {
  return (await client.query(`SELECT e.*, ${NAME("u")} AS actor, a.asset_number FROM tenant.asset_disposal_events e LEFT JOIN public.users u ON u.id = e.actor_user_id LEFT JOIN tenant.assets a ON a.id = e.asset_id
      WHERE e.organization_id = $1 AND e.case_id = $2 ORDER BY e.occurred_at, e.id`, [c.organizationId, caseId])).rows
    .map((e) => ({ id: e.id, action: e.action, asset: e.asset_number ?? null, from: e.from_status, to: e.to_status, details: e.details, reason: e.reason, by: e.actor ?? "System", at: e.occurred_at }));
}
const lineRows = async (client, caseId) => (await client.query(`SELECT l.*, a.asset_number, a.name AS asset_name, a.serial_number, a.lifecycle_status, a.capitalization_class, a.condition, ${NAME("hb")} AS handover_by_name,
    tenant.asset_effective_availability(a) AS effective, cat.name AS category, (SELECT COALESCE(NULLIF(u.full_name, ''), u.email, d.name, s.name) FROM tenant.asset_custody_assignments k LEFT JOIN public.users u ON u.id = k.user_id
      LEFT JOIN public.departments d ON d.id = k.department_id LEFT JOIN tenant.asset_locations s ON s.id = k.store_location_id WHERE k.asset_id = a.id AND k.status = 'ACTIVE') AS custodian_now,
    (SELECT k.custodian_type FROM tenant.asset_custody_assignments k WHERE k.asset_id = a.id AND k.status = 'ACTIVE') AS custodian_type,
    (SELECT o.transfer_number FROM tenant.asset_transfer_lines t JOIN tenant.asset_transfer_orders o ON o.id = t.transfer_id WHERE t.asset_id = a.id AND t.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS') LIMIT 1) AS transfer_now,
    loc.name AS location_now, inv.status AS invoice_status, inv.outstanding_amount AS invoice_outstanding, inv.tax_total AS invoice_tax, inv.grand_total AS invoice_grand, mi.status AS incident_status,
    (SELECT count(*)::int FROM tenant.asset_disposal_exceptions x WHERE x.line_id = l.id AND x.status = 'OPEN') AS open_exceptions,
    (SELECT row_to_json(y) FROM (SELECT p.basis, p.amount FROM tenant.asset_disposal_proceeds_allocations p WHERE p.line_id = l.id AND p.status = 'ACTIVE' LIMIT 1) y) AS allocation,
    ${NAME("db")} AS dispatched_by_name,
    (SELECT row_to_json(x) FROM (SELECT i.status, i.journal_entry_id, i.reversal_journal_entry_id, i.posting_date, i.result, je.entry_number FROM tenant.asset_disposal_accounting_intents i
       LEFT JOIN tenant.accounting_journal_entries je ON je.id = i.journal_entry_id WHERE i.line_id = l.id ORDER BY i.created_at DESC LIMIT 1) x) AS intent
  FROM tenant.asset_disposal_lines l JOIN tenant.assets a ON a.id = l.asset_id LEFT JOIN tenant.asset_categories cat ON cat.id = a.category_id LEFT JOIN tenant.asset_locations loc ON loc.id = a.location_id
    LEFT JOIN public.users hb ON hb.id = l.handover_by LEFT JOIN public.users db ON db.id = l.dispatched_by LEFT JOIN tenant.accounting_customer_invoices inv ON inv.id = l.sale_invoice_id LEFT JOIN tenant.asset_missing_incidents mi ON mi.id = l.missing_incident_id
  WHERE l.case_id = $1 ORDER BY l.line_number`, [caseId])).rows;
// The steps this asset's disposal still needs, in the order they usually happen (each type and asset needs only what applies).
function checklistOf(k, l, picture) {
  const done = (ok, label, detail = null) => ({ label, done: Boolean(ok), detail });
  const steps = [done(["PENDING_HANDOVER", "PENDING_FINANCE", "POSTING", "RECOVERY_REQUIRED", "COMPLETED", "REINSTATED"].includes(l.line_status), "Management disposal approval")];
  if (k.disposal_type === "WRITE_OFF_LOST") steps.push(done(l.incident_status === "CONFIRMED_LOST", "Confirmed loss investigation", l.incident_status ? l.incident_status.toLowerCase().replace(/_/g, " ") : "No missing-asset report"));
  else {
    steps.push(done(!["EMPLOYEE", "DEPARTMENT"].includes(l.custodian_type) || l.custody_exception_reason || l.handover_at, "Custody returned or excepted", l.custody_exception_reason ? `Exception: ${l.custody_exception_reason}` : l.custodian_now ?? null));
    steps.push(done(l.handover_at, "Physical handover", l.handover_kind ? HANDOVER_KINDS[l.handover_kind] : null));
  }
  if (WITH_PROCEEDS.includes(k.disposal_type) && toPaise(l.proposed_proceeds) > 0n) steps.push(done(l.sale_invoice_id && ["posted", "partially_paid", "paid", "overdue", "disputed"].includes(String(l.invoice_status)), "Sales Invoice and tax handling", l.sale_invoice_number));
  if (l.capitalization_class !== "TRACKED_ONLY") {
    steps.push(done(picture ? !picture.pendingDepreciation?.length : null, "Final depreciation", picture?.pendingDepreciation?.length ? `Unposted: ${picture.pendingDepreciation.join(", ")}` : null));
    steps.push(done(l.intent?.status === "POSTED" || l.intent?.status === "REVERSED", "Finance derecognition", l.intent?.entry_number ?? null));
  }
  steps.push(done(["COMPLETED", "REINSTATED"].includes(l.line_status), "Reconciliation and closure"));
  return steps;
}
export async function getAssetDisposal(client, c, caseId) {
  requireSees(c);
  const k = (await client.query(`${LIST} WHERE k.organization_id = $1 AND k.id = $2`, [c.organizationId, idOf(caseId, "Disposal")])).rows[0];
  if (!k) throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND");
  const financials = has(c, DX.financials);
  const lines = [];
  for (const l of await lineRows(client, k.id)) {
    const picture = financials && ["PENDING_HANDOVER", "PENDING_FINANCE", "POSTING", "RECOVERY_REQUIRED", "PENDING_APPROVAL", "DRAFT"].includes(l.line_status) ? await financialPictureOf(client, c, k, l).catch(() => null) : null;
    const snap = financials ? (await client.query(`SELECT * FROM tenant.asset_disposal_financial_snapshots WHERE line_id = $1 AND kind <> 'PREVIEW' ORDER BY version DESC LIMIT 1`, [l.id])).rows[0] : null;
    const liveIntent = financials ? (await client.query(`SELECT * FROM tenant.asset_disposal_accounting_intents WHERE line_id = $1 AND status IN ('PREPARED', 'POSTING', 'POSTED', 'NOT_REQUIRED', 'RECOVERY_REQUIRED') ORDER BY created_at DESC LIMIT 1`, [l.id])).rows[0] : null;
    const state = financials ? financialStateOf(l, liveIntent, snap, picture, liveIntent?.status === "POSTED" ? await journalAgrees(client, liveIntent) : null) : null;
    const costLinks = financials ? (await client.query(`SELECT id, source_number, amount::text, treatment FROM tenant.asset_disposal_cost_links WHERE line_id = $1 AND status = 'ACTIVE' ORDER BY linked_at`, [l.id])).rows : [];
    lines.push({ id: l.id, lineNumber: l.line_number, assetId: l.asset_id, asset: `${l.asset_number} · ${l.asset_name}`, assetNumber: l.asset_number, serialNumber: l.serial_number, category: l.category,
      status: l.line_status, statusLabel: LINE_STATUS[l.line_status], lifecycleThen: l.lifecycle_snapshot, lifecycleNow: l.lifecycle_status, availability: l.effective, tracked: l.capitalization_class === "TRACKED_ONLY",
      custodianThen: l.custodian_label, custodianNow: l.custodian_now ?? null, custodianType: l.custodian_type ?? null, locationThen: l.location_label, locationNow: l.location_now ?? null, transferInProgress: l.transfer_now ?? null,
      condition: l.condition_at_disposal, proposedProceeds: financials || has(c, DX.create) ? money(l.proposed_proceeds) : null, disposalCosts: financials ? money(l.disposal_costs) : null,
      custodyException: l.custody_exception_reason, handover: l.handover_at ? { kind: l.handover_kind, kindLabel: HANDOVER_KINDS[l.handover_kind], recipient: l.handover_recipient, reference: l.handover_reference,
        evidence: l.handover_evidence, at: l.handover_at, by: l.handover_by_name, date: dayOfDb(l.actual_disposition_date) } : l.handover_kind === "LOSS_EVIDENCE" ? { kind: "LOSS_EVIDENCE", kindLabel: HANDOVER_KINDS.LOSS_EVIDENCE, date: dayOfDb(l.actual_disposition_date) } : null,
      saleInvoice: l.sale_invoice_id ? { id: l.sale_invoice_id, number: l.sale_invoice_number, status: l.invoice_status, proceeds: financials ? money(l.sale_proceeds) : null,
        outstanding: financials ? money(l.invoice_outstanding) : null, outputTax: financials ? money(l.invoice_tax) : null, href: `/sales/invoices/${l.sale_invoice_id}` } : null,
      incidentStatus: l.incident_status ?? null,
      milestone: milestoneOf(k, l, l.sale_invoice_id ? { status: l.invoice_status } : null, l.open_exceptions), milestoneLabel: MILESTONES[milestoneOf(k, l, l.sale_invoice_id ? { status: l.invoice_status } : null, l.open_exceptions)],
      agreedPrice: financials || has(c, "assets.disposal.manage_sale") ? money(l.agreed_price) : null, currency: l.agreed_currency ?? k.sale_currency ?? null,
      priceRevision: l.price_revised_at ? { at: l.price_revised_at, reason: l.price_revision_reason } : null, scrapMethod: l.scrap_method ? SCRAP_METHODS[l.scrap_method] : null,
      certificate: { required: l.certificate_required, number: l.certificate_number, issuer: l.certificate_issuer, date: dayOfDb(l.certificate_date), references: l.evidence_references },
      dispatch: l.dispatched_at ? { at: l.dispatched_at, by: l.dispatched_by_name, carrier: l.carrier, reference: l.dispatch_reference } : null,
      allocation: financials && l.allocation ? { basis: l.allocation.basis, amount: money(l.allocation.amount) } : null,
      payment: financials && l.sale_invoice_id ? { invoiced: money(l.invoice_grand), tax: money(l.invoice_tax), received: l.invoice_grand !== null ? fromPaise(toPaise(l.invoice_grand) - toPaise(l.invoice_outstanding ?? 0)) : null, outstanding: money(l.invoice_outstanding) } : null,
      returnedAt: l.returned_at,
      financialState: state, financialStateLabel: state ? FINANCIAL_STATE[state] : null, recognized: Boolean(liveIntent?.status === "POSTED"),
      costLinks: costLinks.map((x) => ({ id: x.id, bill: x.source_number, amount: money(x.amount), treatment: x.treatment })),
      insurance: l.insurance_claim_reference ? { reference: l.insurance_claim_reference, expected: money(l.insurance_expected_amount) } : null,
      finance: financials ? { picture, confirmed: snap ? { version: snap.version, kind: snap.kind, outcome: outcomeOf(snap.gain_loss), gross: money(snap.gross_consideration), tax: money(snap.consideration_tax), separateCosts: money(snap.separate_costs), carrying: money(snap.carrying_amount), cost: money(snap.capitalized_cost), accumulated: money(snap.accumulated_depreciation), impairment: money(snap.impairment),
        proceeds: money(snap.net_proceeds), costs: money(snap.disposal_costs), gainLoss: money(snap.gain_loss), effective: dayOfDb(snap.effective_date), at: snap.confirmed_at } : null,
        intent: l.intent ? { status: l.intent.status, journalEntryId: l.intent.journal_entry_id, journalNumber: l.intent.entry_number, reversalJournalEntryId: l.intent.reversal_journal_entry_id, postingDate: l.intent.posting_date, result: l.intent.result } : null } : null,
      completedAt: l.completed_at, reinstatedAt: l.reinstated_at, reinstatementReason: l.reinstatement_reason, checklist: checklistOf(k, l, picture), href: `/assets/register/${l.asset_id}` });
  }
  const approvals = (await client.query(`SELECT p.*, ${NAME("u")} AS approver, (p.basis_hash = $2 AND p.policy_version = $3) AS current FROM tenant.asset_disposal_approvals p LEFT JOIN public.users u ON u.id = p.approver_user_id
      WHERE p.case_id = $1 ORDER BY p.approved_at`, [k.id, k.basis_hash, k.policy_version])).rows.map((p) => ({ level: p.level, levelLabel: LEVEL_LABEL[p.level], approver: p.approver, at: p.approved_at, note: p.note, current: p.current }));
  const exceptions = (await client.query(`SELECT x.*, a.asset_number FROM tenant.asset_disposal_exceptions x LEFT JOIN tenant.assets a ON a.id = x.asset_id WHERE x.case_id = $1 ORDER BY x.status, x.raised_at DESC`, [k.id])).rows
    .map((x) => ({ id: x.id, code: x.code, asset: x.asset_number, detail: x.detail, responsible: x.responsible, status: x.status, resolution: x.resolution, raisedAt: x.raised_at, resolvedAt: x.resolved_at }));
  const given = approvals.filter((a) => a.current).map((a) => a.level);
  const live = lines.filter((l) => LIVE_LINE.includes(l.status));
  const executing = lines.filter((l) => EXECUTING.includes(l.status));
  return { ...caseRow(k, c), saleCurrency: k.sale_currency ?? null, scrapMethod: k.scrap_method ? SCRAP_METHODS[k.scrap_method] : null, scrapMethodCode: k.scrap_method ?? null,
    generatedInvoiceId: k.generated_invoice_id ?? null, decisionNote: k.decision_note, cancelReason: k.cancel_reason, requiredApprovals: k.required_approvals.map((lv) => ({ level: lv, label: LEVEL_LABEL[lv], given: given.includes(lv) })),
    approvals, lines, exceptions, events: await eventsOf(client, c, k.id), financials,
    can: {
      edit: has(c, DX.create) && ["DRAFT", "CHANGES_REQUESTED"].includes(k.status), submit: has(c, DX.submit) && ["DRAFT", "CHANGES_REQUESTED"].includes(k.status),
      approve: (has(c, DX.approve) || has(c, DX.financeReview)) && k.status === "PENDING_APPROVAL", reject: has(c, DX.reject) && k.status === "PENDING_APPROVAL",
      amend: has(c, DX.create) && ["PENDING_APPROVAL", "APPROVED", "PENDING_HANDOVER"].includes(k.status) && !lines.some((l) => l.handover || l.saleInvoice),
      handover: has(c, DX.handover) && lines.some((l) => l.status === "PENDING_HANDOVER"), linkInvoice: (has(c, DX.create) || has(c, DX.financeReview)) && WITH_PROCEEDS.includes(k.disposal_type) && executing.length > 0,
      prepare: (has(c, DX.financeReview) || has(c, DX.derecognize)) && lines.some((l) => l.status === "PENDING_FINANCE" && !l.tracked && l.finance?.intent?.status !== "POSTED"),
      post: has(c, DX.derecognize) && has(c, "accounting.journal.post") && lines.some((l) => l.finance?.intent?.status === "PREPARED"),
      complete: has(c, DX.complete) && lines.some((l) => l.status === "PENDING_FINANCE"), recover: (has(c, DX.derecognize) || has(c, DX.reconcile)) && lines.some((l) => ["POSTING", "RECOVERY_REQUIRED"].includes(l.status) || (l.finance?.intent?.status === "POSTED" && l.status !== "COMPLETED")),
      cancel: has(c, DX.cancel) && live.length > 0 && !live.some((l) => (l.handover && l.handover.kind !== "LOSS_EVIDENCE") || l.saleInvoice), correct: has(c, DX.correct) && lines.some((l) => l.status === "COMPLETED" || (l.status === "PENDING_FINANCE" && l.handover)),
      reconcile: has(c, DX.reconcile), audit: has(c, DX.audit), financials,
      saleTerms: has(c, "assets.disposal.manage_sale") && k.disposal_type === "SALE" && executing.length > 0, scrapTerms: has(c, "assets.disposal.manage_scrap") && k.disposal_type === "SCRAP" && executing.length > 0,
      allocate: (has(c, "assets.disposal.manage_sale") || has(c, "assets.disposal.manage_scrap")) && ["SALE", "SCRAP"].includes(k.disposal_type) && executing.length > 0,
      createInvoice: (has(c, "assets.disposal.manage_sale") || has(c, "assets.disposal.manage_scrap")) && has(c, "accounting.receivables.manage") && !k.generated_invoice_id && executing.some((l) => !l.saleInvoice)
        && (k.disposal_type === "SALE" || (k.disposal_type === "SCRAP" && k.scrap_method === "SCRAP_DEALER_SALE")),
      dispatch: has(c, DX.handover) && lines.some((l) => l.status === "PENDING_HANDOVER" && !l.dispatch),
      preview: financials && executing.length > 0, linkCost: (has(c, DX.financeReview) || has(c, DX.create)) && lines.some((l) => ["PENDING_HANDOVER", "PENDING_FINANCE"].includes(l.status)),
      insurance: has(c, DX.financeReview) && ["WRITE_OFF_LOST", "WRITE_OFF_DAMAGED", "SCRAP"].includes(k.disposal_type), adjust: has(c, DX.correct) && has(c, "accounting.journal.post") && k.disposal_type === "SALE" && lines.some((l) => l.status === "COMPLETED" && l.saleInvoice), evidence: has(c, "assets.disposal.record_evidence") && ["SCRAP", "WRITE_OFF_DAMAGED"].includes(k.disposal_type) && executing.length > 0 } };
}
// The financial preview of every asset in the case at its derecognition date (Finance-confirmed figures; nothing is saved).
export async function getDisposalFinancialPreview(client, c, caseId) {
  if (!has(c, DX.financials)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = (await client.query(`SELECT * FROM tenant.asset_disposal_cases WHERE organization_id = $1 AND id = $2`, [c.organizationId, idOf(caseId, "Disposal")])).rows[0];
  if (!k) throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND");
  const out = [];
  for (const l of (await client.query(`SELECT l.*, a.asset_number FROM tenant.asset_disposal_lines l JOIN tenant.assets a ON a.id = l.asset_id WHERE l.case_id = $1 AND l.line_status NOT IN ('CANCELLED', 'REJECTED') ORDER BY l.line_number`, [k.id])).rows) {
    out.push({ lineId: l.id, asset: l.asset_number, ...(await financialPictureOf(client, c, k, l)) });
  }
  const sum = (key) => fromPaise(out.filter((x) => x[key] !== null).reduce((t, x) => t + toPaise(x[key]), 0n));
  return { caseId: k.id, lines: out, totals: { cost: sum("cost"), accumulated: sum("accumulated"), carrying: sum("carrying"), proceeds: sum("proceeds"), costs: sum("costs"), gainLoss: sum("gainLoss") } };
}

// ------------------------------------------------------------------ the asset's disposal panel, overview, options
export async function getAssetDisposalPanel(client, c, assetId) {
  requireSees(c);
  const id = idOf(assetId, "Asset");
  const a = (await client.query(`SELECT a.*, tenant.asset_disposal_pending(a.id) AS pending FROM tenant.assets a WHERE a.organization_id = $1 AND a.id = $2`, [c.organizationId, id])).rows[0];
  if (!a) throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND");
  const cases = (await listAssetDisposals(client, c, { assetId: id })).rows;
  const completed = (await client.query(`SELECT l.*, k.case_number, k.disposal_type, (SELECT row_to_json(s) FROM (SELECT carrying_amount, net_proceeds, gain_loss, effective_date FROM tenant.asset_disposal_financial_snapshots f WHERE f.line_id = l.id ORDER BY confirmed_at DESC LIMIT 1) s) AS snap,
      (SELECT je.entry_number FROM tenant.asset_disposal_accounting_intents i JOIN tenant.accounting_journal_entries je ON je.id = i.journal_entry_id WHERE i.line_id = l.id AND i.status IN ('POSTED', 'REVERSED') ORDER BY i.created_at DESC LIMIT 1) AS journal
      FROM tenant.asset_disposal_lines l JOIN tenant.asset_disposal_cases k ON k.id = l.case_id WHERE l.asset_id = $1 AND l.line_status IN ('COMPLETED', 'REINSTATED') ORDER BY l.completed_at DESC LIMIT 1`, [id])).rows[0];
  const legacy = (await client.query(`SELECT disposal_number, disposal_method, disposal_date, net_book_value, proceeds_amount, gain_loss_amount FROM tenant.asset_disposals WHERE asset_id = $1 AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`, [id])).rows[0];
  const fin = has(c, DX.financials);
  return { assetId: id, lifecycle: a.lifecycle_status, pendingCase: a.pending ?? null, cases,
    final: completed ? { case: completed.case_number, type: TYPE_LABEL[completed.disposal_type], status: LINE_STATUS[completed.line_status], date: dayOfDb(completed.actual_disposition_date), handover: completed.handover_kind ? HANDOVER_KINDS[completed.handover_kind] : null,
      recipient: completed.handover_recipient, carrying: fin ? money(completed.snap?.carrying_amount) : null, proceeds: fin ? money(completed.snap?.net_proceeds) : null, gainLoss: fin ? money(completed.snap?.gain_loss) : null,
      journal: fin ? completed.journal : null, reinstatementReason: completed.reinstatement_reason }
      : legacy ? { case: legacy.disposal_number, type: legacy.disposal_method, status: "Disposed (earlier list)", date: dayOfDb(legacy.disposal_date), carrying: fin ? money(legacy.net_book_value) : null,
        proceeds: fin ? money(legacy.proceeds_amount) : null, gainLoss: fin ? money(legacy.gain_loss_amount) : null } : null,
    can: { create: has(c, DX.create) && a.lifecycle_status !== "DISPOSED" && !a.pending && !cases.some((x) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(x.status)) } };
}
export async function getDisposalOverview(client, c) {
  requireSees(c);
  const n = async (where) => Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_disposal_cases k WHERE k.organization_id = $1 AND ${where}`, [c.organizationId])).rows[0].n);
  const lines = async (where) => Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_disposal_lines l WHERE l.organization_id = $1 AND ${where}`, [c.organizationId])).rows[0].n);
  return { drafts: await n(VIEWS.draft), pendingApproval: await n(VIEWS.approval), approved: await n(VIEWS.approved), pendingHandover: await lines("l.line_status = 'PENDING_HANDOVER'"),
    pendingFinance: await lines("l.line_status IN ('PENDING_FINANCE', 'POSTING', 'RECOVERY_REQUIRED')"), completedThisYear: await lines("l.line_status = 'COMPLETED' AND l.completed_at >= date_trunc('year', now())"),
    exceptions: Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_disposal_exceptions WHERE organization_id = $1 AND status = 'OPEN'`, [c.organizationId])).rows[0].n),
    can: { create: has(c, DX.create), bulk: has(c, DX.bulk), reconcile: has(c, DX.reconcile), export: has(c, DX.export), audit: has(c, DX.audit), financials: has(c, DX.financials) } };
}
export async function getDisposalOptions(client, c) {
  requireSees(c);
  const buyers = (await client.query(`SELECT id, display_name FROM tenant.business_parties WHERE organization_id = $1 AND party_type IN ('customer', 'both') ORDER BY display_name LIMIT 2000`, [c.organizationId])).rows;
  const recyclers = (await client.query(`SELECT s.id, p.display_name FROM tenant.procurement_suppliers s JOIN tenant.business_parties p ON p.id = s.party_id WHERE s.organization_id = $1 AND s.status = 'active' ORDER BY p.display_name LIMIT 2000`, [c.organizationId])).rows;
  return { buyers: buyers.map((b) => ({ value: b.id, label: b.display_name })), recyclers: recyclers.map((r) => ({ value: r.id, label: r.display_name })),
    types: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })), reasons: Object.entries(REASONS).filter(([k]) => k !== "CARRIED_OVER").map(([value, label]) => ({ value, label })) };
}
export async function listDisposalExceptions(client, c, filters = {}) {
  requireSees(c);
  return (await client.query(`SELECT x.*, k.case_number, a.asset_number, a.name AS asset_name FROM tenant.asset_disposal_exceptions x JOIN tenant.asset_disposal_cases k ON k.id = x.case_id LEFT JOIN tenant.assets a ON a.id = x.asset_id
      WHERE x.organization_id = $1 AND ($2::text IS NULL OR x.status = $2) ORDER BY x.status, x.raised_at DESC LIMIT 500`, [c.organizationId, filters.status ?? "OPEN"])).rows
    .map((x) => ({ id: x.id, code: x.code, label: x.code.replace(/_/g, " ").toLowerCase().replace(/^./, (y) => y.toUpperCase()), case: x.case_number, caseId: x.case_id, asset: x.asset_number ? `${x.asset_number} · ${x.asset_name}` : null,
      detail: x.detail, responsible: x.responsible, status: x.status, resolution: x.resolution, raisedAt: x.raised_at, href: `/assets/disposals/${x.case_id}` }));
}

// ------------------------------------------------------------------ reports, export, audit
export const DISPOSAL_REPORTS = Object.freeze(["register", "by-method", "by-period", "by-category", "gain-loss", "proceeds-vs-carrying", "pending-disposal", "handover-pending", "finance-pending", "write-offs",
  "scrapped", "corrections", "reconciliation", "by-location-department",
  // Asset Sale / Scrap (MVP 26)
  "asset-sales", "scrap-register", "sales-by-category", "sale-proceeds-by-period", "scrap-proceeds-by-period", "carrying-value-at-disposal", "gain-loss-on-sale", "scrap-certificates-missing",
  "sale-invoice-reconciliation", "returned-sales", "bulk-progress",
  // Gain / Loss on Disposal (MVP 27)
  "asset-gain-loss", "monthly-gain-loss", "annual-gain-loss", "gains-by-category", "losses-by-category", "scrap-write-off-losses", "fully-depreciated-sales", "gain-loss-by-location", "gain-loss-by-department",
  "pending-financial-results", "adjusted-results", "disposal-gl-reconciliation"]);
const FINANCIAL = ["gain-loss", "proceeds-vs-carrying", "asset-sales", "sale-proceeds-by-period", "scrap-proceeds-by-period", "carrying-value-at-disposal", "gain-loss-on-sale", "sale-invoice-reconciliation"];
// Every disposed or pending asset line with its confirmed figures (null without the financial permission or before Finance confirmed them).
async function reportLines(client, c) {
  const fin = has(c, DX.financials);
  const rows = (await client.query(`SELECT l.*, k.case_number, k.disposal_type, k.id AS kid, a.asset_number, a.name AS asset_name, cat.name AS category, loc.name AS location, dep.name AS department,
      (SELECT row_to_json(s) FROM (SELECT carrying_amount, net_proceeds, disposal_costs, gain_loss, capitalized_cost, accumulated_depreciation FROM tenant.asset_disposal_financial_snapshots f WHERE f.line_id = l.id ORDER BY confirmed_at DESC LIMIT 1) s) AS snap,
      (SELECT i.status FROM tenant.asset_disposal_accounting_intents i WHERE i.line_id = l.id ORDER BY i.created_at DESC LIMIT 1) AS posting
    FROM tenant.asset_disposal_lines l JOIN tenant.asset_disposal_cases k ON k.id = l.case_id JOIN tenant.assets a ON a.id = l.asset_id LEFT JOIN tenant.asset_categories cat ON cat.id = a.category_id
      LEFT JOIN tenant.asset_locations loc ON loc.id = l.location_snapshot_id LEFT JOIN tenant.asset_custody_assignments ks ON ks.id = l.custody_snapshot_id LEFT JOIN public.departments dep ON dep.id = ks.department_id
    WHERE l.organization_id = $1 AND l.line_status NOT IN ('CANCELLED', 'REJECTED', 'DRAFT') ORDER BY l.completed_at DESC NULLS FIRST, k.case_number`, [c.organizationId])).rows;
  return rows.map((l) => ({ case: l.case_number, asset: `${l.asset_number} · ${l.asset_name}`, method: TYPE_LABEL[l.disposal_type], type: l.disposal_type, status: LINE_STATUS[l.line_status], lineStatus: l.line_status,
    category: l.category ?? "—", location: l.location ?? "—", department: l.department ?? "—", date: dayOfDb(l.actual_disposition_date), completed: l.completed_at, tracked: l.capitalization_snapshot === "TRACKED_ONLY",
    proposedProceeds: fin ? money(l.proposed_proceeds) : null, confirmedCarrying: fin ? money(l.snap?.carrying_amount) : null, confirmedProceeds: fin ? money(l.snap?.net_proceeds) : null,
    gainLoss: fin ? money(l.snap?.gain_loss) : null, posting: l.posting ?? "—", invoice: l.sale_invoice_number ?? "—", handover: l.handover_kind ? HANDOVER_KINDS[l.handover_kind] : "—", href: `/assets/disposals/${l.kid}` }));
}
export async function getDisposalReport(client, c, kind, filters = {}) {
  if (GAIN_LOSS_REPORTS.includes(kind)) return getGainLossReport(client, c, kind, filters);
  if (!DISPOSAL_REPORTS.includes(kind)) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Unknown report.");
  requireSees(c);
  if (FINANCIAL.includes(kind) && !has(c, DX.financials)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const all = await reportLines(client, c);
  const done = all.filter((l) => l.lineStatus === "COMPLETED");
  const group = (rows, key) => [...rows.reduce((m, r) => m.set(r[key] ?? "—", [...(m.get(r[key] ?? "—") ?? []), r]), new Map()).entries()];
  const total = (rows, key) => fromPaise(rows.reduce((t, r) => t + (r[key] ? toPaise(r[key]) : 0n), 0n));
  const brief = (r) => ({ case: r.case, asset: r.asset, method: r.method, status: r.status, date: r.date ?? "—", href: r.href });
  switch (kind) {
    case "register": {
      const legacy = (await client.query(`SELECT d.disposal_number, a.asset_number, a.name, d.disposal_method, d.disposal_date FROM tenant.asset_disposals d JOIN tenant.assets a ON a.id = d.asset_id WHERE d.organization_id = $1 AND d.status = 'completed' ORDER BY d.disposal_date DESC`, [c.organizationId])).rows;
      return [...all.map((r) => ({ ...brief(r), posting: r.posting, invoice: r.invoice })), ...legacy.map((d) => ({ case: d.disposal_number, asset: `${d.asset_number} · ${d.name}`, method: d.disposal_method, status: "Disposed (earlier list)", date: dayOfDb(d.disposal_date), posting: "—", invoice: "—" }))];
    }
    case "by-method": return group(all, "method").map(([method, rows]) => ({ method, assets: rows.length, disposed: rows.filter((r) => r.lineStatus === "COMPLETED").length, pending: rows.filter((r) => r.lineStatus !== "COMPLETED").length }));
    case "by-period": return group(done.map((r) => ({ ...r, month: String(r.date ?? "").slice(0, 7) || "—" })), "month").sort((x, y) => String(y[0]).localeCompare(String(x[0])))
      .map(([month, rows]) => ({ month, assets: rows.length, ...(has(c, DX.financials) ? { gainLoss: total(rows, "gainLoss") } : {}) }));
    case "by-category": return group(all, "category").map(([category, rows]) => ({ category, assets: rows.length, disposed: rows.filter((r) => r.lineStatus === "COMPLETED").length }));
    case "gain-loss": return done.filter((r) => !r.tracked).map((r) => ({ ...brief(r), carrying: r.confirmedCarrying ?? "—", proceeds: r.confirmedProceeds ?? "—", gainLoss: r.gainLoss ?? "—" }))
      .concat(done.some((r) => !r.tracked) ? [{ case: "Total", asset: "", method: "", status: "", date: "", carrying: total(done, "confirmedCarrying"), proceeds: total(done, "confirmedProceeds"), gainLoss: total(done, "gainLoss") }] : []);
    case "proceeds-vs-carrying": return all.filter((r) => ["SALE", "SCRAP"].includes(r.type)).map((r) => ({ ...brief(r), proposedProceeds: r.proposedProceeds ?? "—", confirmedProceeds: r.confirmedProceeds ?? "Not yet confirmed", confirmedCarrying: r.confirmedCarrying ?? "Not yet confirmed" }));
    case "pending-disposal": return all.filter((r) => EXECUTING.includes(r.lineStatus)).map(brief);
    case "handover-pending": return all.filter((r) => r.lineStatus === "PENDING_HANDOVER").map(brief);
    case "finance-pending": return all.filter((r) => ["PENDING_FINANCE", "POSTING", "RECOVERY_REQUIRED"].includes(r.lineStatus) && !r.tracked).map((r) => ({ ...brief(r), posting: r.posting }));
    case "write-offs": return all.filter((r) => ["WRITE_OFF_LOST", "WRITE_OFF_DAMAGED"].includes(r.type)).map((r) => ({ ...brief(r), carrying: r.confirmedCarrying ?? "—" }));
    case "scrapped": return all.filter((r) => r.type === "SCRAP").map((r) => ({ ...brief(r), handover: r.handover, invoice: r.invoice }));
    case "corrections": return (await client.query(`SELECT e.action, e.reason, e.occurred_at, k.case_number, a.asset_number, k.id AS kid FROM tenant.asset_disposal_events e JOIN tenant.asset_disposal_cases k ON k.id = e.case_id LEFT JOIN tenant.assets a ON a.id = e.asset_id
        WHERE e.organization_id = $1 AND e.action IN ('REVERSED_AND_REINSTATED', 'RETURNED_BEFORE_COMPLETION', 'AMENDED', 'SALE_INVOICE_UNLINKED', 'POSTING_RECOVERED') ORDER BY e.occurred_at DESC`, [c.organizationId])).rows
      .map((e) => ({ case: e.case_number, asset: e.asset_number ?? "—", correction: e.action.replace(/_/g, " ").toLowerCase(), reason: e.reason ?? "—", at: e.occurred_at, href: `/assets/disposals/${e.kid}` }));
    case "reconciliation": return (await listDisposalExceptions(client, c, { status: "OPEN" })).map((x) => ({ case: x.case, asset: x.asset ?? "—", exception: x.label, detail: x.detail, responsible: x.responsible, href: x.href }));
    case "asset-sales": case "scrap-register": case "scrap-certificates-missing": case "sale-invoice-reconciliation": case "bulk-progress": {
      const { getSaleScrapExecutionQueue } = await import("./dx-execution.js");
      const q = await getSaleScrapExecutionQueue(client, c, { type: kind === "asset-sales" || kind === "sale-invoice-reconciliation" ? "SALE" : kind === "bulk-progress" ? null : "SCRAP" });
      const fig = new Map(all.map((r) => [r.href + r.asset, r]));
      if (kind === "asset-sales") return q.map((x) => ({ case: x.case, asset: x.asset, buyer: x.buyer ?? "—", progress: x.milestoneLabel, requestedPrice: x.agreedPrice ?? "—", invoiced: x.allocated ?? "—",
        postedProceeds: fig.get(x.href + x.asset)?.confirmedProceeds ?? "Not yet posted", collected: x.invoicePaid ?? "—", gainLoss: fig.get(x.href + x.asset)?.gainLoss ?? "—", href: x.href }));
      if (kind === "scrap-register") return q.map((x) => ({ case: x.case, asset: x.asset, method: x.scrapMethod ?? "—", progress: x.milestoneLabel, certificate: x.certificate ?? (x.certificateRequired ? "Missing" : "Not required"), scrapValue: x.agreedPrice ?? "0.00", href: x.href }));
      if (kind === "scrap-certificates-missing") return q.filter((x) => x.certificateRequired && !x.certificate).map((x) => ({ case: x.case, asset: x.asset, method: x.scrapMethod ?? "—", progress: x.milestoneLabel, href: x.href }));
      if (kind === "sale-invoice-reconciliation") return q.map((x) => ({ case: x.case, asset: x.asset, invoice: x.invoice ?? "None", invoiceStatus: x.invoiceStatus ?? "—", allocatedBeforeGst: x.allocated ?? "—", gst: x.invoiceTax ?? "—",
        agreedPrice: x.agreedPrice ?? "—", agrees: x.allocated !== null && x.agreedPrice !== null ? (x.allocated === x.agreedPrice ? "Yes" : "Differs from the agreed price") : "—", href: x.href }));
      return [...q.reduce((m, x) => m.set(x.case, [...(m.get(x.case) ?? []), x]), new Map()).entries()].map(([kase, rows]) => ({ case: kase, assets: rows.length, ...Object.fromEntries(Object.entries(MILESTONES).map(([code, label]) => [label, rows.filter((r) => r.milestone === code).length])), href: rows[0].href }));
    }
    case "sales-by-category": return group(all.filter((r) => r.type === "SALE"), "category").map(([category, rows]) => ({ category, assets: rows.length, sold: rows.filter((r) => r.lineStatus === "COMPLETED").length }));
    case "sale-proceeds-by-period": case "scrap-proceeds-by-period": {
      const rows = done.filter((r) => r.type === (kind === "sale-proceeds-by-period" ? "SALE" : "SCRAP"));
      return group(rows.map((r) => ({ ...r, month: String(r.date ?? "").slice(0, 7) || "—" })), "month").sort((x, y) => String(y[0]).localeCompare(String(x[0])))
        .map(([month, list]) => ({ month, assets: list.length, postedProceeds: total(list, "confirmedProceeds"), gainLoss: total(list, "gainLoss") }));
    }
    case "carrying-value-at-disposal": return done.filter((r) => !r.tracked).map((r) => ({ ...brief(r), carryingValue: r.confirmedCarrying ?? "—" }));
    case "gain-loss-on-sale": return done.filter((r) => r.type === "SALE").map((r) => ({ ...brief(r), proceeds: r.confirmedProceeds ?? "—", carrying: r.confirmedCarrying ?? (r.tracked ? "Tracked only" : "—"), gainLoss: r.gainLoss ?? "—" }));
    case "returned-sales": return (await client.query(`SELECT e.action, e.reason, e.occurred_at, e.details, k.case_number, a.asset_number, k.id AS kid FROM tenant.asset_disposal_events e JOIN tenant.asset_disposal_cases k ON k.id = e.case_id LEFT JOIN tenant.assets a ON a.id = e.asset_id
        WHERE e.organization_id = $1 AND e.action IN ('RETURNED_BY_BUYER', 'RETURNED_BEFORE_COMPLETION', 'REVERSED_AND_REINSTATED') AND k.disposal_type = 'SALE' ORDER BY e.occurred_at DESC`, [c.organizationId])).rows
      .map((e) => ({ case: e.case_number, asset: e.asset_number ?? "—", what: e.action.replace(/_/g, " ").toLowerCase(), creditNote: e.details?.creditNote ?? "—", reason: e.reason ?? "—", at: e.occurred_at, href: `/assets/disposals/${e.kid}` }));
    case "by-location-department": return group(all.map((r) => ({ ...r, place: `${r.location} / ${r.department}` })), "place").map(([place, rows]) => ({ locationDepartment: place, assets: rows.length, disposed: rows.filter((r) => r.lineStatus === "COMPLETED").length }));
    default: return [];
  }
}
export async function getDisposalAudit(client, c, filters = {}) {
  if (!has(c, DX.audit)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const values = [c.organizationId];
  let where = "";
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where = `AND e.asset_id = $${values.length}`; }
  return (await client.query(`SELECT e.*, ${NAME("u")} AS actor, a.asset_number, k.case_number FROM tenant.asset_disposal_events e LEFT JOIN public.users u ON u.id = e.actor_user_id LEFT JOIN tenant.assets a ON a.id = e.asset_id
      LEFT JOIN tenant.asset_disposal_cases k ON k.id = e.case_id WHERE e.organization_id = $1 ${where} ORDER BY e.occurred_at DESC LIMIT 1000`, values)).rows
    .map((e) => ({ id: e.id, case: e.case_number, asset: e.asset_number, action: e.action, from: e.from_status, to: e.to_status, reason: e.reason, by: e.actor ?? "System", at: e.occurred_at }));
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) || /^[=+@-]/.test(s) ? `"${(/^[=+@-]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
export async function exportAssetDisposals(client, c) {
  if (!has(c, DX.export)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const fin = has(c, DX.financials);
  const rows = await reportLines(client, c);
  const header = ["Disposal", "Asset", "Method", "Status", "Disposition date", "Handover", "Sales Invoice", "Derecognition", ...(fin ? ["Proposed proceeds", "Confirmed carrying value", "Confirmed proceeds", "Gain / loss"] : [])];
  return { fileName: "asset-disposals.csv", csv: [header, ...rows.map((r) => [r.case, r.asset, r.method, r.status, r.date ?? "", r.handover, r.invoice, r.posting,
    ...(fin ? [r.proposedProceeds ?? "", r.confirmedCarrying ?? "", r.confirmedProceeds ?? "", r.gainLoss ?? ""] : [])])].map((l) => l.map(csvCell).join(",")).join("\r\n") };
}
