// Assets — Purchase and Capitalization, the commands. Eligible costs are allocated to assets (or a CWIP project) from their exact
// source lines; a capitalization request snapshots the proposal (purchase price, components, the journal it implies) for Finance to
// review; Finance approves it (never its requester) and an authorized person posts it once — a reclassification from the bill line's
// account to the category's fixed-asset account, never a second supplier liability. CWIP is posted into its account and transferred
// to the assets it becomes once they are commissioned. Later credits, extra costs and corrections are approved adjustments.
import { has, loadSettings, recordAssetEvent, text, uuid } from "../common.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import {
  ALLOCATABLE, CAP, LIVE, POSTED_BILL, capError, centsText, dayOfDb, fromDb, requireAnyCap, requireCap, split, toCents,
} from "./cap-rules.js";

const dayOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? String(v) : null);
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const idOf = (value, label, code = "ASSET_CAPITALIZATION_NOT_FOUND") => { try { return uuid(value, label); } catch { throw capError(404, code); } };

export async function logCapEvent(client, c, action, refs = {}, details = {}, reason = null) {
  await client.query(`INSERT INTO tenant.asset_capitalization_events (organization_id, asset_id, cwip_id, capitalization_id, adjustment_id, action, details, reason, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [c.organizationId, refs.assetId ?? null, refs.cwipId ?? null, refs.capitalizationId ?? null, refs.adjustmentId ?? null, action, JSON.stringify(details), reason, c.userId]);
}
async function usersWith(client, c, permission) {
  return (await client.query(`SELECT DISTINCT assignment.user_id FROM user_role_assignments assignment JOIN role_permissions grant_row ON grant_row.role_id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.status = 'active' AND grant_row.permission_key = $2`, [c.organizationId, permission]).catch(() => ({ rows: [] }))).rows.map((r) => r.user_id);
}
async function tell(client, c, permission, title, message, href) {
  for (const userId of await usersWith(client, c, permission)) {
    if (userId === c.userId) continue;
    await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_register", title, message, href, entityType: null, entityId: null });
  }
}
export async function loadCapAsset(client, c, assetId, { lock = false } = {}) {
  const id = idOf(assetId, "Asset", "ASSET_NOT_FOUND");
  const row = (await client.query(`SELECT a.*, cat.name AS category_name, cat.asset_account_id, cat.cwip_account_id AS category_cwip_account_id, cat.depreciation_method AS category_method, cat.useful_life_months AS category_life
      FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id = a.category_id WHERE a.organization_id = $1 AND a.id = $2${lock ? " FOR UPDATE OF a" : ""}`, [c.organizationId, id])).rows[0];
  if (!row) throw capError(404, "ASSET_NOT_FOUND", "This asset is not available.");
  return row;
}
export async function billLine(client, c, lineId) {
  const id = idOf(lineId, "Source line", "ASSET_ACQUISITION_SOURCE_INVALID");
  const row = (await client.query(`SELECT line.*, bill.id AS bill_id, bill.bill_number, bill.bill_type, bill.status AS bill_status, btrim(bill.currency_code) AS bill_currency, bill.exchange_rate, bill.party_id,
      to_char(bill.bill_date, 'YYYY-MM-DD') AS bill_date FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id WHERE line.organization_id = $1 AND line.id = $2`, [c.organizationId, id])).rows[0];
  if (!row) throw capError(404, "ASSET_CAPITALIZATION_COMPANY_MISMATCH", "That supplier bill line was not found in this Company.");
  return row;
}
async function baseCurrency(client, c) {
  return (await client.query(`SELECT upper(base_currency) AS c FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.c ?? "INR";
}
async function usedOnLine(client, lineId, tax) {
  const q = tax ? `SELECT COALESCE(sum(abs(amount)), 0) AS n FROM tenant.asset_cost_components WHERE source_line_id = $1 AND source_type = 'SUPPLIER_INVOICE_TAX' AND status = 'ACTIVE'`
    : `SELECT (SELECT COALESCE(sum(abs(amount)), 0) FROM tenant.asset_cost_components WHERE source_line_id = $1 AND source_type = 'SUPPLIER_INVOICE_LINE' AND status = 'ACTIVE')
        + (SELECT COALESCE(sum(allocated_cost), 0) FROM tenant.asset_acquisition_allocations WHERE source_line_id = $1 AND status = 'ACTIVE') AS n`;
  return toCents((await client.query(q, [lineId])).rows[0].n);
}

// ------------------------------------------------------------------ cost allocation
// input: { component, sourceType: SUPPLIER_INVOICE_LINE | MANUAL, sourceLineId?, assetIds? | cwipId?, amount? (default: what remains on the
//   line), method: EQUAL | PROPORTIONAL | MANUAL, shares?: [{ assetId, amount }], offsetAccountId? (manual), reason?, commandId? }
// One source amount split across assets — deterministically, the rounding remainder to the last — never above what the source still has.
export async function allocateAcquisitionCosts(client, c, input = {}) {
  requireAnyCap(c, input.cwipId ? [CAP.allocate, CAP.cwip] : [CAP.allocate]);
  const command = text(input.commandId, 200) || null;
  if (command) {
    const done = (await client.query(`SELECT group_id FROM tenant.asset_cost_components WHERE organization_id = $1 AND command_id LIKE $2 || ':%' LIMIT 1`, [c.organizationId, command])).rows[0];
    if (done) return { groupId: done.group_id, replayed: true, allocations: await groupRows(client, done.group_id) };
  }
  const component = String(input.component ?? "").toUpperCase();
  if (!ALLOCATABLE.includes(component) || (component === "PURCHASE_PRICE" && !input.cwipId)) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Choose what kind of cost this is.", { field: "component" });
  const reason = text(input.reason, 1000) || null;
  // Targets: one CWIP project, or the assets sharing the cost.
  let targets;
  if (input.cwipId) {
    const project = (await client.query(`SELECT * FROM tenant.asset_cwip_projects WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, idOf(input.cwipId, "CWIP project")])).rows[0];
    if (!project) throw capError(404, "ASSET_CAPITALIZATION_NOT_FOUND", "That CWIP project was not found.");
    if (project.status !== "OPEN") throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Costs are added to a CWIP project while it is open.");
    if ((await client.query(`SELECT 1 FROM tenant.asset_capitalizations WHERE cwip_id = $1 AND status IN ('APPROVED', 'POSTING', 'POSTED')`, [project.id])).rows[0]) throw capError(409, "ASSET_CAPITALIZATION_ALREADY_POSTED", "This CWIP balance is already approved; a new cost goes into a new request after it is posted.");
    targets = [{ cwipId: project.id, weight: 1n }];
  } else {
    const ids = [...new Set((Array.isArray(input.assetIds) ? input.assetIds : (input.shares ?? []).map((s) => s.assetId)).map(String))];
    if (!ids.length || ids.length > 500) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Choose the assets that share this cost.", { field: "assetIds" });
    targets = [];
    for (const id of ids) {
      const a = await loadCapAsset(client, c, id, { lock: true });
      if (a.capitalization_class === "CAPITALIZED") throw capError(409, "ASSET_CAPITALIZATION_ALREADY_POSTED", `${a.asset_number} is already capitalized; a later cost is an adjustment.`);
      if (a.capitalization_class === "TRACKED_ONLY") throw capError(409, "ASSET_CAPITALIZATION_NOT_ELIGIBLE", `${a.asset_number} is tracked only; its costs are expensed.`);
      if (["DISPOSED"].includes(a.lifecycle_status) || a.archived_at) throw capError(409, "ASSET_CAPITALIZATION_NOT_ELIGIBLE", `${a.asset_number} is no longer in the register.`);
      const live = (await client.query(`SELECT status FROM tenant.asset_capitalizations WHERE asset_id = $1 AND status IN ('APPROVED', 'POSTING')`, [a.id])).rows[0];
      if (live) throw capError(409, "ASSET_CAPITALIZATION_VERSION_CONFLICT", `${a.asset_number}'s capitalization is already approved; post it first, then adjust.`);
      const price = (await client.query(`SELECT COALESCE(sum(allocated_cost), 0) AS p FROM tenant.asset_acquisition_allocations WHERE asset_id = $1 AND status = 'ACTIVE'`, [a.id])).rows[0].p;
      targets.push({ assetId: a.id, number: a.asset_number, weight: toCents(price) });
    }
  }
  // The source and what it still has.
  let source = { type: "MANUAL", line: null, document: null, currency: await baseCurrency(client, c), rate: "1", offset: input.offsetAccountId ? idOf(input.offsetAccountId, "Account", "ASSET_CAPITALIZATION_GL_MAPPING_MISSING") : null, remaining: null };
  if (String(input.sourceType ?? "MANUAL").toUpperCase() !== "MANUAL") {
    const line = await billLine(client, c, input.sourceLineId);
    if (line.bill_type !== "bill" || !["approved", ...POSTED_BILL].includes(line.bill_status)) throw capError(409, "ASSET_ACQUISITION_SOURCE_INVALID", `${line.bill_number} is not an approved supplier bill.`);
    const tax = component === "NONRECOVERABLE_TAX";
    const available = toCents(tax ? line.tax_amount : line.net_amount);
    source = { type: tax ? "SUPPLIER_INVOICE_TAX" : "SUPPLIER_INVOICE_LINE", line: line.id, document: line.bill_id, currency: line.bill_currency || source.currency, rate: String(line.exchange_rate ?? 1),
      offset: tax ? line.tax_account_id : line.expense_account_id, remaining: available - (await usedOnLine(client, line.id, tax)), label: `${line.bill_number} · ${line.description}` };
    if (component === "DISCOUNT") throw capError(400, "ASSET_CAPITALIZATION_INVALID", "A discount is entered by hand against the assets' purchase (the bill line's net is already after its line discount).");
  } else {
    if (!reason || reason.length < 3) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Give the reason and evidence for a cost without a source line.", { field: "reason" });
    if (component !== "DISCOUNT" && !source.offset) throw capError(400, "ASSET_CAPITALIZATION_GL_MAPPING_MISSING", "Choose the Finance account the cost is in now.", { field: "offsetAccountId" });
  }
  // Amounts.
  const method = String(input.method ?? (input.shares ? "MANUAL" : "EQUAL")).toUpperCase();
  if (!["EQUAL", "PROPORTIONAL", "MANUAL"].includes(method)) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Allocate equally, in proportion to purchase value, or by amount.");
  const sign = component === "DISCOUNT" ? -1n : 1n;
  let shares;
  if (method === "MANUAL" && !input.cwipId) {
    const byAsset = new Map((input.shares ?? []).map((s) => [String(s.assetId), toCents(s.amount)]));
    shares = targets.map((t) => byAsset.get(t.assetId) ?? 0n);
    if (shares.some((s) => s <= 0n)) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Give each asset an amount above zero.", { field: "shares" });
  } else {
    const total = input.amount === undefined || input.amount === null || input.amount === "" ? source.remaining : toCents(input.amount);
    if (total === null || total <= 0n) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Enter the amount to allocate.", { field: "amount" });
    if (method === "PROPORTIONAL" && targets.some((t) => t.weight <= 0n)) throw capError(409, "ASSET_ACQUISITION_COST_PENDING", "Every asset needs its purchase value to share a cost in proportion.");
    shares = split(total, targets.map((t) => (method === "PROPORTIONAL" ? t.weight : 1n)));
  }
  const total = shares.reduce((a, b) => a + b, 0n);
  if (source.remaining !== null && total > source.remaining) {
    throw capError(409, "ASSET_ACQUISITION_ALREADY_ALLOCATED", `Only ${centsText(source.remaining < 0n ? 0n : source.remaining)} of ${source.label} is still unallocated.`, { remaining: centsText(source.remaining) });
  }
  const groupId = (await client.query(`SELECT gen_random_uuid() AS id`)).rows[0].id;
  try {
    for (const [i, t] of targets.entries()) {
      const amount = shares[i] * sign;
      const reporting = Math.round(Number(centsText(amount)) * Number(source.rate) * 100) / 100;
      await client.query(`INSERT INTO tenant.asset_cost_components (organization_id, asset_id, cwip_id, component, source_type, source_document_id, source_line_id, method, group_id, amount, currency, exchange_rate,
          reporting_amount, offset_account_id, reason, command_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [c.organizationId, t.assetId ?? null, t.cwipId ?? null, component, source.type, source.document, source.line, input.cwipId ? "FULL" : method, groupId, centsText(amount), source.currency, source.rate,
          reporting.toFixed(2), source.offset, reason, command ? `${command}:${i + 1}` : null, c.userId]);
    }
  } catch (failure) { throw fromDb(failure); }
  for (const t of targets) await logCapEvent(client, c, "COST_ALLOCATED", { assetId: t.assetId, cwipId: t.cwipId }, { groupId, component, method, source: source.label ?? "manual" }, reason);
  return { groupId, allocations: await groupRows(client, groupId) };
}
async function groupRows(client, groupId) {
  return (await client.query(`SELECT id, asset_id, cwip_id, amount, reporting_amount FROM tenant.asset_cost_components WHERE group_id = $1 ORDER BY component_number`, [groupId])).rows
    .map((r) => ({ componentId: r.id, assetId: r.asset_id, cwipId: r.cwip_id, amount: String(r.amount), reportingAmount: String(r.reporting_amount) }));
}
// An unposted allocation is reversed (and made again correctly); a capitalized one is corrected by an adjustment.
export async function reverseCostAllocation(client, c, componentId, input = {}) {
  requireAnyCap(c, [CAP.allocate, CAP.cwip]);
  const row = (await client.query(`SELECT * FROM tenant.asset_cost_components WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, idOf(componentId, "Allocation")])).rows[0];
  if (!row) throw capError(404, "ASSET_CAPITALIZATION_NOT_FOUND", "That allocation was not found.");
  if (row.status === "REVERSED") return { componentId: row.id, status: "REVERSED", replayed: true };
  if (row.capitalization_id) throw capError(409, "ASSET_CAPITALIZATION_ALREADY_POSTED", "This cost is capitalized; Finance corrects it with an adjustment.");
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Give a reason.", { field: "reason" });
  if (row.cwip_id && (await client.query(`SELECT 1 FROM tenant.asset_cost_components WHERE source_cwip_id = $1 AND status = 'ACTIVE'`, [row.cwip_id])).rows[0]) {
    throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Part of this CWIP balance is already transferred to assets.");
  }
  await client.query(`UPDATE tenant.asset_cost_components SET status = 'REVERSED', reversed_by = $2, reversed_at = clock_timestamp(), reversal_reason = $3 WHERE id = $1`, [row.id, c.userId, reason]);
  await logCapEvent(client, c, "COST_REVERSED", { assetId: row.asset_id, cwipId: row.cwip_id }, { componentId: row.id, amount: String(row.amount) }, reason);
  return { componentId: row.id, status: "REVERSED" };
}

// ------------------------------------------------------------------ the proposal
// What capitalizing the asset (or posting a CWIP project) would mean: its components, the total in the base currency, the journal it
// implies, and anything that blocks it. Never throws for a business issue — the issues are listed.
export async function computeProposal(client, c, target) {
  const issues = [];
  const block = (code, message) => issues.push({ code, message });
  const components = [];
  const base = await baseCurrency(client, c);
  let debit = null;
  let taxReview = false;
  if (target.assetId) {
    const a = await loadCapAsset(client, c, target.assetId);
    debit = a.asset_account_id;
    if (a.capitalization_class === "TRACKED_ONLY") block("ASSET_CAPITALIZATION_NOT_ELIGIBLE", "This asset is tracked only; its cost is expensed.");
    if (a.capitalization_class === "CAPITALIZED") block("ASSET_CAPITALIZATION_ALREADY_POSTED", "This asset is already capitalized.");
    const allocation = (await client.query(`SELECT * FROM tenant.asset_acquisition_allocations WHERE asset_id = $1 AND status = 'ACTIVE'`, [a.id])).rows[0];
    const fromCwip = (await client.query(`SELECT 1 FROM tenant.asset_cost_components WHERE asset_id = $1 AND component = 'CWIP_TRANSFER' AND status = 'ACTIVE'`, [a.id])).rows[0];
    if (allocation?.source_type === "OPENING_BALANCE") block("ASSET_CAPITALIZATION_NOT_ELIGIBLE", "An asset brought in at the cutover is valued through Opening / Existing Assets, not as a new purchase.");
    else if (allocation?.source_type === "MANUAL_EXCEPTION" && !fromCwip) block("ASSET_ACQUISITION_SOURCE_INVALID", "Link the asset to its supplier bill line before capitalizing it.");
    else if (!allocation && !fromCwip) block("ASSET_ACQUISITION_SOURCE_INVALID", "Link the asset to its purchase before capitalizing it.");
    else if (allocation && allocation.source_type !== "MANUAL_EXCEPTION") {
      // The purchase price, from the supplier bill line (directly, or the bill of the purchase order line it was received against).
      let line = null;
      if (allocation.source_type === "SUPPLIER_INVOICE_LINE") line = await billLine(client, c, allocation.source_line_id);
      else if (allocation.root_po_line_id) {
        const found = (await client.query(`SELECT line.id FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id
            WHERE line.organization_id = $1 AND line.purchase_order_line_id = $2 AND bill.bill_type = 'bill' AND bill.status <> 'cancelled' ORDER BY bill.created_at DESC LIMIT 1`, [c.organizationId, allocation.root_po_line_id])).rows[0];
        if (found) line = await billLine(client, c, found.id);
      }
      if (!line) block("ASSET_ACQUISITION_COST_PENDING", "Registered — cost pending Finance: the supplier bill is not recorded yet.");
      else if (!POSTED_BILL.includes(line.bill_status)) block("ASSET_ACQUISITION_COST_PENDING", `${line.bill_number} is not posted yet, so there is nothing in Finance to capitalize.`);
      if (allocation.allocated_cost === null) block("ASSET_ACQUISITION_COST_PENDING", "The unit's purchase cost is not known yet.");
      if (line) {
        const cost = Number(allocation.allocated_cost ?? 0);
        const rate = Number(line.exchange_rate ?? 1);
        components.push({ id: allocation.id, fromAllocation: true, component: "PURCHASE_PRICE", source: `${line.bill_number} · ${line.description}`, sourceLineId: line.id, amount: cost.toFixed(2), currency: line.bill_currency || base,
          rate: String(rate), reporting: (Math.round(cost * rate * 100) / 100).toFixed(2), offsetAccountId: line.expense_account_id, costStatus: allocation.cost_status });
        // Tax: recoverable GST is never capitalized. Where Finance has not settled the input credit, or found it ineligible, it decides.
        if (Number(line.tax_amount) > 0) {
          const itc = (await client.query(`SELECT itc_status FROM tenant.accounting_tax_ledger WHERE organization_id = $1 AND source_id = $2 AND direction = 'input'`, [c.organizationId, line.bill_id]).catch(() => ({ rows: [] }))).rows.map((r) => r.itc_status);
          const decided = (await client.query(`SELECT 1 FROM tenant.asset_cost_components WHERE asset_id = $1 AND component = 'NONRECOVERABLE_TAX' AND status = 'ACTIVE'`, [a.id])).rows[0];
          if (!decided && itc.some((s) => s === "PENDING" || s === "INELIGIBLE")) taxReview = true;
        }
      }
    }
  } else {
    const project = (await client.query(`SELECT p.*, cat.cwip_account_id AS category_cwip FROM tenant.asset_cwip_projects p LEFT JOIN tenant.asset_categories cat ON cat.id = p.category_id WHERE p.organization_id = $1 AND p.id = $2`,
      [c.organizationId, target.cwipId])).rows[0];
    if (!project) throw capError(404, "ASSET_CAPITALIZATION_NOT_FOUND", "That CWIP project was not found.");
    debit = project.cwip_account_id ?? project.category_cwip;
  }
  const rows = (await client.query(`SELECT * FROM tenant.asset_cost_components WHERE ${target.assetId ? "asset_id" : "cwip_id"} = $1 AND status = 'ACTIVE' AND capitalization_id IS NULL ORDER BY component_number`, [target.assetId ?? target.cwipId])).rows;
  const purchaseOffset = components[0]?.offsetAccountId ?? null;
  for (const r of rows) {
    components.push({ id: r.id, component: r.component, source: r.source_type === "MANUAL" ? `Entered by hand: ${r.reason}` : r.source_type === "CWIP" ? "Capital work in progress" : null, sourceLineId: r.source_line_id,
      amount: String(r.amount), currency: r.currency, rate: String(r.exchange_rate), reporting: String(r.reporting_amount), offsetAccountId: r.offset_account_id ?? (r.component === "DISCOUNT" ? purchaseOffset : null) });
  }
  if (!debit) block("ASSET_CAPITALIZATION_GL_MAPPING_MISSING", target.assetId ? "The asset's category has no fixed-asset account: set its financial policy." : "Choose the CWIP account for this project (or the category's).");
  if (components.some((x) => !x.offsetAccountId)) block("ASSET_CAPITALIZATION_GL_MAPPING_MISSING", "A cost has no Finance account to move it from (a nonrecoverable tax line needs its tax account).");
  const totalCents = components.reduce((t, x) => t + toCents(x.reporting), 0n);
  if (totalCents <= 0n && !issues.length) block("ASSET_CAPITALIZATION_INVALID", "There is no cost to capitalize.");
  // The journal: debit the fixed-asset (or CWIP) account, credit each account the cost sits in now; a cost already in that account moves nowhere.
  const credits = new Map();
  for (const x of components) { if (!x.offsetAccountId || x.offsetAccountId === debit) continue; credits.set(x.offsetAccountId, (credits.get(x.offsetAccountId) ?? 0n) + toCents(x.reporting)); }
  const moved = [...credits.values()].reduce((t, v) => t + v, 0n);
  const journal = debit && moved !== 0n ? [{ accountId: debit, debit: centsText(moved > 0n ? moved : 0n), credit: centsText(moved < 0n ? -moved : 0n) },
    ...[...credits.entries()].filter(([, v]) => v !== 0n).map(([accountId, v]) => ({ accountId, debit: centsText(v < 0n ? -v : 0n), credit: centsText(v > 0n ? v : 0n) }))] : [];
  return { total: centsText(totalCents), currency: base, components, journal, debitAccountId: debit, taxReview, issues, outcome: journal.length ? "POSTED" : "ALREADY_IN_ASSET_ACCOUNT" };
}
export async function previewCapitalization(client, c, input = {}) {
  requireAnyCap(c, [CAP.request, CAP.review, CAP.approve, CAP.viewCost]);
  return computeProposal(client, c, input.cwipId ? { cwipId: idOf(input.cwipId, "CWIP project") } : { assetId: input.assetId });
}

// ------------------------------------------------------------------ requests
async function loadCap(client, c, capId, { lock = true } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.asset_capitalizations WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, idOf(capId, "Capitalization")])).rows[0];
  if (!row) throw capError(404, "ASSET_CAPITALIZATION_NOT_FOUND");
  return row;
}
const versionCheck = (row, expected) => { if (expected !== undefined && expected !== null && Number(expected) !== Number(row.row_version)) throw capError(409, "ASSET_CAPITALIZATION_VERSION_CONFLICT"); };
// input: { assetId | cwipId, capitalizationDate, availableForUseDate?, depreciationStartDate?, note? } — submitted for Finance review.
export async function requestCapitalization(client, c, input = {}) {
  requireCap(c, CAP.request);
  const target = input.cwipId ? { cwipId: idOf(input.cwipId, "CWIP project") } : { assetId: (await loadCapAsset(client, c, input.assetId, { lock: true })).id };
  const live = (await client.query(`SELECT id, capitalization_number, status FROM tenant.asset_capitalizations WHERE ${target.assetId ? "asset_id" : "cwip_id"} = $1 AND status NOT IN ('REJECTED', 'REVERSED')`, [target.assetId ?? target.cwipId])).rows[0];
  if (live?.status === "POSTED") throw capError(409, "ASSET_CAPITALIZATION_ALREADY_POSTED");
  if (live) throw capError(409, "ASSET_CAPITALIZATION_VERSION_CONFLICT", `CAP-${live.capitalization_number} is already open for it.`);
  const capDate = dayOf(input.capitalizationDate) ?? todayIso();
  const ready = input.availableForUseDate ? dayOf(input.availableForUseDate) : null;
  if (input.availableForUseDate && !ready) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Enter the available-for-use date as a date.", { field: "availableForUseDate" });
  const p = await computeProposal(client, c, target);
  if (p.issues.length) throw capError(409, p.issues[0].code, p.issues.map((x) => x.message).join(" "), { issues: p.issues });
  let asset = null;
  if (target.assetId) asset = await loadCapAsset(client, c, target.assetId);
  const inService = asset ? dayOfDb(asset.placed_in_service_date) : null;
  const made = (await client.query(`INSERT INTO tenant.asset_capitalizations (organization_id, asset_id, cwip_id, status, treatment, proposed_amount, currency, components, journal_lines, debit_account_id, capitalization_date,
      available_for_use_date, depreciation_start_date, tax_review, note, requested_by) VALUES ($1,$2,$3,'PENDING_REVIEW',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [c.organizationId, target.assetId ?? null, target.cwipId ?? null, target.cwipId ? "CWIP" : "CAPITALIZE", p.total, p.currency, JSON.stringify(p.components), JSON.stringify(p.journal), p.debitAccountId, capDate,
      ready ?? inService, dayOf(input.depreciationStartDate), p.taxReview, text(input.note, 1000) || null, c.userId])).rows[0];
  await logCapEvent(client, c, "REQUESTED", { assetId: target.assetId, cwipId: target.cwipId, capitalizationId: made.id }, { total: p.total, components: p.components.length, taxReview: p.taxReview });
  await tell(client, c, CAP.approve, `Capitalization CAP-${made.capitalization_number} waits for Finance`, `${asset ? `${asset.asset_number} · ${asset.name}` : "A CWIP project"}: ${p.currency} ${p.total} proposed.`, `/assets/capitalization/${made.id}`);
  return capView(made);
}
// Journal lines compared by content, whatever order (jsonb reorders keys).
const canonLines = (lines) => (lines ?? []).map((l) => `${l.accountId}|${toCents(l.debit)}|${toCents(l.credit)}`).sort().join(";");
const capView = (r) => ({ capitalizationId: r.id, number: `CAP-${r.capitalization_number}`, status: r.status, total: String(r.proposed_amount), version: r.row_version });
export async function requestCapitalizationChanges(client, c, capId, input = {}) {
  requireAnyCap(c, [CAP.review, CAP.approve]);
  const row = await loadCap(client, c, capId);
  versionCheck(row, input.expectedVersion);
  if (row.status !== "PENDING_REVIEW") throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Only a request waiting for Finance can be sent back.");
  const note = text(input.note, 1000);
  if (note.length < 3) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Say what needs correcting.", { field: "note" });
  const next = (await client.query(`UPDATE tenant.asset_capitalizations SET status = 'CHANGES_REQUESTED', review_note = $2, reviewed_by = $3 WHERE id = $1 RETURNING *`, [row.id, note, c.userId])).rows[0];
  await logCapEvent(client, c, "CHANGES_REQUESTED", { assetId: row.asset_id, cwipId: row.cwip_id, capitalizationId: row.id }, {}, note);
  return capView(next);
}
// The proposal is recomputed from the corrected sources.
export async function resubmitCapitalization(client, c, capId, input = {}) {
  requireCap(c, CAP.request);
  const row = await loadCap(client, c, capId);
  if (row.status !== "CHANGES_REQUESTED") throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Only a request sent back for changes is resubmitted.");
  const p = await computeProposal(client, c, row.asset_id ? { assetId: row.asset_id } : { cwipId: row.cwip_id });
  if (p.issues.length) throw capError(409, p.issues[0].code, p.issues.map((x) => x.message).join(" "), { issues: p.issues });
  const next = (await client.query(`UPDATE tenant.asset_capitalizations SET status = 'PENDING_REVIEW', proposed_amount = $2, components = $3, journal_lines = $4, debit_account_id = $5, tax_review = $6,
      capitalization_date = COALESCE($7, capitalization_date), available_for_use_date = COALESCE($8, available_for_use_date), note = COALESCE($9, note) WHERE id = $1 RETURNING *`,
    [row.id, p.total, JSON.stringify(p.components), JSON.stringify(p.journal), p.debitAccountId, p.taxReview, dayOf(input.capitalizationDate), dayOf(input.availableForUseDate), text(input.note, 1000) || null])).rows[0];
  await logCapEvent(client, c, "RESUBMITTED", { assetId: row.asset_id, cwipId: row.cwip_id, capitalizationId: row.id }, { total: p.total });
  return capView(next);
}
export async function rejectCapitalization(client, c, capId, input = {}) {
  requireCap(c, CAP.approve);
  const row = await loadCap(client, c, capId);
  if (!["PENDING_REVIEW", "CHANGES_REQUESTED", "APPROVED"].includes(row.status)) throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Only an open request is rejected.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Give the reason.", { field: "reason" });
  const next = (await client.query(`UPDATE tenant.asset_capitalizations SET status = 'REJECTED', rejection_reason = $2, reviewed_by = $3 WHERE id = $1 RETURNING *`, [row.id, reason, c.userId])).rows[0];
  await logCapEvent(client, c, "REJECTED", { assetId: row.asset_id, cwipId: row.cwip_id, capitalizationId: row.id }, {}, reason);
  return capView(next);
}
// input: { treatment?: CAPITALIZE | TRACKED_EXPENSED | NOT_ELIGIBLE, taxReviewed?, depreciationStartDate?, note?, expectedVersion? } — Finance's
// decision, never the requester's. The proposal must still be what was reviewed; expensing it makes the asset tracked only.
export async function approveCapitalization(client, c, capId, input = {}) {
  requireCap(c, CAP.approve);
  const row = await loadCap(client, c, capId);
  versionCheck(row, input.expectedVersion);
  if (row.status === "APPROVED" || row.status === "POSTED") return { ...capView(row), replayed: true };
  if (row.status !== "PENDING_REVIEW") throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Only a request waiting for Finance is approved.");
  if (row.requested_by === c.userId) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED", "The person who requested a capitalization cannot approve it.");
  const settings = await loadSettings(client, c);
  if (row.asset_id && settings.prohibit_self_approval !== false) {
    const a = await loadCapAsset(client, c, row.asset_id);
    if (a.created_by === c.userId) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED", "The person who registered the asset cannot approve its capitalization.");
  }
  const treatment = String(input.treatment ?? (row.cwip_id ? "CWIP" : "CAPITALIZE")).toUpperCase();
  if (!["CAPITALIZE", "CWIP", "TRACKED_EXPENSED", "NOT_ELIGIBLE"].includes(treatment) || (treatment === "CWIP") !== Boolean(row.cwip_id)) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Choose the treatment.");
  const note = text(input.note, 1000) || null;
  if (treatment === "NOT_ELIGIBLE") {
    if (!note) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Say why it is not eligible.", { field: "note" });
    const next = (await client.query(`UPDATE tenant.asset_capitalizations SET status = 'REJECTED', treatment = 'NOT_ELIGIBLE', rejection_reason = $2, reviewed_by = $3 WHERE id = $1 RETURNING *`, [row.id, note, c.userId])).rows[0];
    await logCapEvent(client, c, "NOT_ELIGIBLE", { assetId: row.asset_id, capitalizationId: row.id }, {}, note);
    return capView(next);
  }
  if (treatment === "TRACKED_EXPENSED") {
    // Expensed: the cost stays where the bill put it; the asset is tracked only. Nothing is posted.
    const next = (await client.query(`UPDATE tenant.asset_capitalizations SET status = 'POSTED', treatment = 'TRACKED_EXPENSED', approved_by = $2, approved_at = clock_timestamp(), posted_by = $2, posted_at = clock_timestamp(),
        accounting_outcome = 'NOT_REQUIRED', review_note = $3 WHERE id = $1 RETURNING *`, [row.id, c.userId, note])).rows[0];
    await client.query(`UPDATE tenant.assets SET capitalization_class = 'TRACKED_ONLY', depreciation_method = 'none', accounting_status = 'not_required' WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.asset_id]);
    await logCapEvent(client, c, "EXPENSED", { assetId: row.asset_id, capitalizationId: row.id }, { total: String(row.proposed_amount) }, note);
    await recordAssetEvent(client, c, row.asset_id, "asset.capitalization_expensed", { capitalizationId: row.id });
    return capView(next);
  }
  const p = await computeProposal(client, c, row.asset_id ? { assetId: row.asset_id } : { cwipId: row.cwip_id });
  if (p.issues.length) throw capError(409, p.issues[0].code, p.issues.map((x) => x.message).join(" "), { issues: p.issues });
  if (toCents(p.total) !== toCents(row.proposed_amount) || canonLines(p.journal) !== canonLines(row.journal_lines)) throw capError(409, "ASSET_CAPITALIZATION_VERSION_CONFLICT", "The costs changed since the request; send it back to be resubmitted.");
  if (row.tax_review && input.taxReviewed !== true) throw capError(409, "ASSET_CAPITALIZATION_TAX_REVIEW", "Confirm the purchase tax treatment (recoverable GST is never capitalized) before approving.");
  const start = input.depreciationStartDate ? dayOf(input.depreciationStartDate) : dayOfDb(row.depreciation_start_date);
  if (input.depreciationStartDate && !start) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Enter the depreciation start as a date.", { field: "depreciationStartDate" });
  if (start && row.available_for_use_date && start < dayOfDb(row.available_for_use_date)) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Depreciation cannot start before the asset is available for use.", { field: "depreciationStartDate" });
  const next = (await client.query(`UPDATE tenant.asset_capitalizations SET status = 'APPROVED', approved_by = $2, approved_at = clock_timestamp(), tax_reviewed = $3, depreciation_start_date = $4, review_note = COALESCE($5, review_note)
      WHERE id = $1 RETURNING *`, [row.id, c.userId, input.taxReviewed === true, start, note])).rows[0];
  // Finance has confirmed the purchase price it reviewed.
  for (const x of p.components.filter((y) => y.fromAllocation)) await client.query(`UPDATE tenant.asset_acquisition_allocations SET cost_status = 'FINANCE_CONFIRMED' WHERE id = $1`, [x.id]);
  await logCapEvent(client, c, "APPROVED", { assetId: row.asset_id, cwipId: row.cwip_id, capitalizationId: row.id }, { total: p.total, taxReviewed: input.taxReviewed === true }, note);
  await tell(client, c, CAP.post, `Capitalization CAP-${row.capitalization_number} approved — to post`, `${p.currency} ${p.total}`, `/assets/capitalization/${row.id}`);
  return capView(next);
}

// ------------------------------------------------------------------ posting
// input: { postingKey? } — once: the journal carries the request as its source, so a retry after an unknown outcome finds it instead of
// posting again. Approval does not grant posting; posting does not need to be the approver.
export async function postCapitalization(client, c, capId, input = {}) {
  requireCap(c, CAP.post);
  const row = await loadCap(client, c, capId);
  const key = text(input.postingKey, 200) || null;
  if (row.status === "POSTED") {
    if (key && row.posting_key === key) return { ...capView(row), journalEntryId: row.journal_entry_id, replayed: true };
    throw capError(409, "ASSET_CAPITALIZATION_ALREADY_POSTED");
  }
  if (row.status === "RECOVERY_REQUIRED" || row.status === "POSTING") return recoverCapitalizationPosting(client, c, row.id);
  if (row.status !== "APPROVED") throw capError(409, "ASSET_CAPITALIZATION_APPROVAL_REQUIRED");
  const existing = await journalFor(client, c, row.id);
  if (existing) return finishPosting(client, c, row, existing, key, "RECOVERED");
  await client.query(`UPDATE tenant.asset_capitalizations SET status = 'POSTING', posting_key = $2 WHERE id = $1`, [row.id, key]);
  let journalId = null;
  const lines = row.journal_lines ?? [];
  if (lines.length) {
    const { postAssetJournal } = await import("../accounting-bridge.js");
    const asset = row.asset_id ? await loadCapAsset(client, c, row.asset_id) : null;
    let posted;
    try {
      posted = await postAssetJournal(client, c, {
        date: dayOfDb(row.capitalization_date), reference: `CAP-${row.capitalization_number}`, description: asset ? `Capitalization of ${asset.asset_number} - ${asset.name}` : `Capital work in progress CAP-${row.capitalization_number}`,
        sourceType: "asset_capitalization", sourceId: row.id, sourceNumber: `CAP-${row.capitalization_number}`,
        lines: lines.map((l) => ({ accountId: l.accountId, debitCents: toCents(l.debit), creditCents: toCents(l.credit), description: asset ? asset.name : "CWIP" })),
      });
    } catch (failure) {
      const m = String(failure?.message ?? "");
      if (/Fiscal period .+ is (soft_closed|closed|locked)|period is (closed|not open)|No fiscal period covers/i.test(m)) throw capError(409, "ASSET_CAPITALIZATION_PERIOD_CLOSED", `The accounting period for ${dayOfDb(row.capitalization_date)} is not open. ${m}`);
      throw failure;
    }
    if (posted.status !== "posted") throw capError(409, "ASSET_CAPITALIZATION_GL_MAPPING_MISSING", "Finance has no asset journal or account set up for this posting.");
    journalId = posted.journalEntryId;
  }
  return finishPosting(client, c, row, journalId, key, lines.length ? "POSTED" : "ALREADY_IN_ASSET_ACCOUNT");
}
async function journalFor(client, c, capId) {
  return (await client.query(`SELECT id FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND source_type = 'asset_capitalization' AND source_id = $2 ORDER BY created_at LIMIT 1`, [c.organizationId, capId])).rows[0]?.id ?? null;
}
async function finishPosting(client, c, row, journalId, key, outcome) {
  const next = (await client.query(`UPDATE tenant.asset_capitalizations SET status = 'POSTED', posted_by = $2, posted_at = clock_timestamp(), journal_entry_id = $3, posting_key = COALESCE($4, posting_key), accounting_outcome = $5
      WHERE id = $1 RETURNING *`, [row.id, c.userId, journalId, key, outcome === "RECOVERED" ? "POSTED" : outcome])).rows[0];
  const ids = (row.components ?? []).filter((x) => !x.fromAllocation).map((x) => x.id);
  if (ids.length) await client.query(`UPDATE tenant.asset_cost_components SET capitalization_id = $2 WHERE id = ANY($1::uuid[])`, [ids, row.id]);
  if (row.asset_id) {
    const a = await loadCapAsset(client, c, row.asset_id, { lock: true });
    // Depreciation starts when Finance says, never on the purchase date: the approved start, else the available-for-use date of a commissioned asset.
    const start = dayOfDb(row.depreciation_start_date) ?? (a.lifecycle_status === "ACTIVE" ? dayOfDb(row.available_for_use_date) ?? dayOfDb(a.placed_in_service_date) : null);
    const updated = (await client.query(`UPDATE tenant.assets SET capitalization_class = 'CAPITALIZED', capitalized_cost = $3, net_book_value = $3 - COALESCE(accumulated_depreciation, 0), capitalization_date = $4,
        depreciation_start_date = $5, capitalized_by = $6, capitalized_at = clock_timestamp(), accounting_status = $7, capitalization_journal_id = $8,
        depreciation_method = COALESCE(NULLIF(depreciation_method, 'none'), $9, 'straight_line') WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [c.organizationId, a.id, row.proposed_amount, dayOfDb(row.capitalization_date), start, c.userId, journalId ? "posted" : "not_required", journalId, a.category_method])).rows[0];
    if (start) await (await import("../asset-depreciation/dp-commands.js")).onAssetCapitalized(client, c, updated.id, { capitalizationId: row.id });
    await recordAssetEvent(client, c, a.id, "asset.capitalized", { capitalizationId: row.id, amount: String(row.proposed_amount), journalEntryId: journalId, depreciationStart: start });
  }
  await logCapEvent(client, c, outcome === "RECOVERED" ? "POSTING_RECOVERED" : "POSTED", { assetId: row.asset_id, cwipId: row.cwip_id, capitalizationId: row.id }, { journalEntryId: journalId, outcome });
  return { ...capView(next), journalEntryId: journalId, outcome: next.accounting_outcome };
}
// A posting whose outcome is unknown: the journal is looked for by its source; found, the request is completed; not found, it returns to
// approved so it can be posted — never twice.
export async function recoverCapitalizationPosting(client, c, capId) {
  requireAnyCap(c, [CAP.post, CAP.reconcile]);
  const row = await loadCap(client, c, capId);
  if (row.status === "POSTED") return { ...capView(row), journalEntryId: row.journal_entry_id, replayed: true };
  if (!["POSTING", "RECOVERY_REQUIRED"].includes(row.status)) throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Nothing to recover.");
  const journal = await journalFor(client, c, row.id);
  if (journal) return finishPosting(client, c, row, journal, null, "RECOVERED");
  const next = (await client.query(`UPDATE tenant.asset_capitalizations SET status = 'APPROVED' WHERE id = $1 RETURNING *`, [row.id])).rows[0];
  await logCapEvent(client, c, "POSTING_NOT_FOUND", { assetId: row.asset_id, capitalizationId: row.id }, {});
  return { ...capView(next), journalEntryId: null };
}
// A posted capitalization reversed by Finance — only before any depreciation is posted on it; the components are released.
export async function reverseCapitalization(client, c, capId, input = {}) {
  requireCap(c, CAP.post);
  const row = await loadCap(client, c, capId);
  if (row.status === "REVERSED") return { ...capView(row), replayed: true };
  if (row.status !== "POSTED" || row.treatment === "TRACKED_EXPENSED") throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Only a posted capitalization is reversed.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Give the reason.", { field: "reason" });
  if (row.asset_id) {
    const posted = await (await import("../asset-depreciation/dp-commands.js")).postedDepreciationExists(client, row.asset_id);
    if (posted) throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Depreciation is already posted on this asset; Finance reverses it first.");
    if ((await client.query(`SELECT 1 FROM tenant.asset_capitalization_adjustments WHERE capitalization_id = $1 AND status = 'POSTED'`, [row.id])).rows[0]) throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Adjustments are posted on this capitalization; reverse them first.");
  } else if ((await client.query(`SELECT 1 FROM tenant.asset_cost_components WHERE source_cwip_id = $1 AND status = 'ACTIVE'`, [row.cwip_id])).rows[0]) {
    throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Part of this CWIP is transferred to assets.");
  }
  let reversal = null;
  if (row.journal_entry_id) {
    const { reverseAssetJournal } = await import("../accounting-bridge.js");
    reversal = (await reverseAssetJournal(client, c, row.journal_entry_id, reason))?.entry?.id ?? null;
  }
  await client.query(`SELECT set_config('vercent.capitalization_reversal', 'on', true)`);
  await client.query(`UPDATE tenant.asset_cost_components SET capitalization_id = NULL WHERE capitalization_id = $1`, [row.id]);
  await client.query(`SELECT set_config('vercent.capitalization_reversal', '', true)`);
  const next = (await client.query(`UPDATE tenant.asset_capitalizations SET status = 'REVERSED', reversed_by = $2, reversed_at = clock_timestamp(), reversal_reason = $3, reversal_journal_entry_id = $4 WHERE id = $1 RETURNING *`,
    [row.id, c.userId, reason, reversal])).rows[0];
  if (row.asset_id) {
    await (await import("../asset-depreciation/dp-commands.js")).onCapitalizationReversed(client, c, row.asset_id);
    await client.query(`UPDATE tenant.assets SET capitalization_class = 'PENDING', capitalized_cost = 0, net_book_value = 0, capitalization_date = NULL, depreciation_start_date = NULL, capitalized_by = NULL, capitalized_at = NULL,
        accounting_status = 'not_required', capitalization_journal_id = NULL WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.asset_id]);
    await recordAssetEvent(client, c, row.asset_id, "asset.capitalization_reversed", { capitalizationId: row.id, reason });
  }
  await logCapEvent(client, c, "REVERSED", { assetId: row.asset_id, cwipId: row.cwip_id, capitalizationId: row.id }, { reversalJournalEntryId: reversal }, reason);
  return capView(next);
}
// input: { date } — when a capitalized asset is commissioned later, Finance sets its depreciation start (never before it was ready for use).
export async function setDepreciationStart(client, c, assetId, input = {}) {
  requireCap(c, CAP.approve);
  const a = await loadCapAsset(client, c, assetId, { lock: true });
  if (a.capitalization_class !== "CAPITALIZED") throw capError(409, "ASSET_CAPITALIZATION_APPROVAL_REQUIRED", "Capitalize the asset first.");
  if (a.lifecycle_status !== "ACTIVE") throw capError(409, "ASSET_CWIP_NOT_READY", "Commission the asset before its depreciation starts.");
  if (a.depreciation_start_date) throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Its depreciation already has a start date.");
  const day = dayOf(input.date);
  if (!day) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Enter the start as a date.", { field: "date" });
  if (a.placed_in_service_date && day < dayOfDb(a.placed_in_service_date)) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Depreciation cannot start before the asset was available for use.", { field: "date" });
  const updated = (await client.query(`UPDATE tenant.assets SET depreciation_start_date = $3 WHERE organization_id = $1 AND id = $2 RETURNING *`, [c.organizationId, a.id, day])).rows[0];
  await (await import("../asset-depreciation/dp-commands.js")).onAssetCapitalized(client, c, updated.id, {});
  await logCapEvent(client, c, "DEPRECIATION_START_SET", { assetId: a.id }, { date: day });
  return { assetId: a.id, depreciationStartDate: day };
}

// ------------------------------------------------------------------ capital work in progress
// input: { name, description?, categoryId?, cwipAccountId? }
export async function createCwipProject(client, c, input = {}) {
  requireCap(c, CAP.cwip);
  const name = text(input.name, 200);
  if (name.length < 2) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Name the CWIP project.", { field: "name" });
  const categoryId = input.categoryId ? idOf(input.categoryId, "Category", "ASSET_CAPITALIZATION_INVALID") : null;
  if (categoryId && !(await client.query(`SELECT 1 FROM tenant.asset_categories WHERE organization_id = $1 AND id = $2`, [c.organizationId, categoryId])).rows[0]) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Choose a category of this Company.");
  const account = input.cwipAccountId ? idOf(input.cwipAccountId, "Account", "ASSET_CAPITALIZATION_GL_MAPPING_MISSING") : null;
  if (account && !(await client.query(`SELECT 1 FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2 AND NOT is_group`, [c.organizationId, account])).rows[0]) throw capError(400, "ASSET_CAPITALIZATION_GL_MAPPING_MISSING", "Choose a Finance account of this Company.");
  const made = (await client.query(`INSERT INTO tenant.asset_cwip_projects (organization_id, name, description, category_id, cwip_account_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [c.organizationId, name, text(input.description, 2000) || null, categoryId, account, c.userId])).rows[0];
  await logCapEvent(client, c, "CWIP_CREATED", { cwipId: made.id }, { name });
  return { cwipId: made.id, number: `CWIP-${made.cwip_number}` };
}
// input: { readyAt, evidence } — commissioning evidence: the work is ready for use.
export async function markCwipReady(client, c, cwipId, input = {}) {
  requireCap(c, CAP.cwip);
  const p = (await client.query(`SELECT * FROM tenant.asset_cwip_projects WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, idOf(cwipId, "CWIP project")])).rows[0];
  if (!p) throw capError(404, "ASSET_CAPITALIZATION_NOT_FOUND", "That CWIP project was not found.");
  if (p.status !== "OPEN") throw capError(409, "ASSET_CAPITALIZATION_INVALID", "Only an open CWIP project becomes ready.");
  const day = dayOf(input.readyAt);
  const evidence = text(input.evidence, 1000);
  if (!day || evidence.length < 3) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Give the date it became ready for use and the commissioning evidence.");
  await client.query(`UPDATE tenant.asset_cwip_projects SET status = 'READY', ready_at = $2, ready_evidence = $3 WHERE id = $1`, [p.id, day, evidence]);
  await logCapEvent(client, c, "CWIP_READY", { cwipId: p.id }, { readyAt: day }, evidence);
  return { cwipId: p.id, status: "READY" };
}
// input: { method: EQUAL | MANUAL, assetIds? | shares: [{ assetId, amount }], commandId? } — the posted CWIP balance (or part of it) moved to the
// commissioned assets it became: a transfer, never a new purchase. Each asset is then capitalized from it.
export async function transferCwip(client, c, cwipId, input = {}) {
  requireCap(c, CAP.cwip);
  const p = (await client.query(`SELECT * FROM tenant.asset_cwip_projects WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, idOf(cwipId, "CWIP project")])).rows[0];
  if (!p) throw capError(404, "ASSET_CAPITALIZATION_NOT_FOUND", "That CWIP project was not found.");
  const command = text(input.commandId, 200) || null;
  if (command) {
    const done = (await client.query(`SELECT group_id FROM tenant.asset_cost_components WHERE organization_id = $1 AND command_id LIKE $2 || ':%' LIMIT 1`, [c.organizationId, command])).rows[0];
    if (done) return { cwipId: p.id, replayed: true, allocations: await groupRows(client, done.group_id) };
  }
  if (p.status !== "READY") throw capError(409, "ASSET_CWIP_NOT_READY", "Record that the work is ready for use before transferring it.");
  const cap = (await client.query(`SELECT * FROM tenant.asset_capitalizations WHERE cwip_id = $1 AND status = 'POSTED'`, [p.id])).rows[0];
  if (!cap) throw capError(409, "ASSET_CAPITALIZATION_APPROVAL_REQUIRED", "Post the CWIP balance through Finance before transferring it.");
  const balance = toCents((await client.query(`SELECT COALESCE(sum(reporting_amount), 0) AS n FROM tenant.asset_cost_components WHERE cwip_id = $1 AND status = 'ACTIVE'`, [p.id])).rows[0].n);
  const moved = toCents((await client.query(`SELECT COALESCE(sum(reporting_amount), 0) AS n FROM tenant.asset_cost_components WHERE source_cwip_id = $1 AND status = 'ACTIVE'`, [p.id])).rows[0].n);
  const remaining = balance - moved;
  const ids = [...new Set((input.shares ? input.shares.map((s) => s.assetId) : input.assetIds ?? []).map(String))];
  if (!ids.length) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Choose the assets the work became.", { field: "assetIds" });
  const assets = [];
  for (const id of ids) {
    const a = await loadCapAsset(client, c, id, { lock: true });
    if (a.lifecycle_status !== "ACTIVE") throw capError(409, "ASSET_CWIP_NOT_READY", `${a.asset_number} is not commissioned yet.`);
    if (a.capitalization_class !== "PENDING") throw capError(409, "ASSET_CAPITALIZATION_NOT_ELIGIBLE", `${a.asset_number} is already ${a.capitalization_class === "CAPITALIZED" ? "capitalized" : "tracked only"}.`);
    assets.push(a);
  }
  let shares;
  if (input.shares) {
    const by = new Map(input.shares.map((s) => [String(s.assetId), toCents(s.amount)]));
    shares = assets.map((a) => by.get(a.id) ?? 0n);
    if (shares.some((s) => s <= 0n)) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Give each asset an amount above zero.");
  } else shares = split(remaining, assets.map(() => 1n));
  const total = shares.reduce((x, y) => x + y, 0n);
  if (total > remaining) throw capError(409, "ASSET_ACQUISITION_ALREADY_ALLOCATED", `Only ${centsText(remaining)} of this CWIP is still to transfer.`);
  const account = cap.debit_account_id;
  const groupId = (await client.query(`SELECT gen_random_uuid() AS id`)).rows[0].id;
  const currency = await baseCurrency(client, c);
  try {
    for (const [i, a] of assets.entries()) {
      await client.query(`INSERT INTO tenant.asset_cost_components (organization_id, asset_id, component, source_type, source_cwip_id, method, group_id, amount, currency, reporting_amount, offset_account_id, command_id, created_by)
          VALUES ($1,$2,'CWIP_TRANSFER','CWIP',$3,$4,$5,$6,$7,$6,$8,$9,$10)`, [c.organizationId, a.id, p.id, input.shares ? "MANUAL" : "EQUAL", groupId, centsText(shares[i]), currency, account, command ? `${command}:${i + 1}` : null, c.userId]);
      await logCapEvent(client, c, "CWIP_TRANSFERRED", { assetId: a.id, cwipId: p.id }, { amount: centsText(shares[i]) });
    }
  } catch (failure) { throw fromDb(failure); }
  if (total === remaining) await client.query(`UPDATE tenant.asset_cwip_projects SET status = 'TRANSFERRED' WHERE id = $1`, [p.id]);
  return { cwipId: p.id, status: total === remaining ? "TRANSFERRED" : "READY", remaining: centsText(remaining - total), allocations: await groupRows(client, groupId) };
}

// ------------------------------------------------------------------ adjustments after capitalization
// input: { kind: CREDIT_NOTE | ADDITIONAL_COST | CORRECTION, sourceLineId? (a credit-note or supplier bill line), amount (CORRECTION: signed),
//   offsetAccountId? (CORRECTION), reason, evidence?, commandId? }
export async function requestCapitalizationAdjustment(client, c, assetId, input = {}) {
  requireCap(c, CAP.adjust);
  const command = text(input.commandId, 200) || null;
  if (command) {
    const done = (await client.query(`SELECT * FROM tenant.asset_capitalization_adjustments WHERE organization_id = $1 AND command_id = $2`, [c.organizationId, command])).rows[0];
    if (done) return { adjustmentId: done.id, number: `ADJ-${done.adjustment_number}`, status: done.status, replayed: true };
  }
  const a = await loadCapAsset(client, c, assetId, { lock: true });
  const cap = (await client.query(`SELECT * FROM tenant.asset_capitalizations WHERE asset_id = $1 AND status = 'POSTED' AND treatment = 'CAPITALIZE'`, [a.id])).rows[0];
  if (a.capitalization_class !== "CAPITALIZED" || !cap) throw capError(409, "ASSET_CAPITALIZATION_APPROVAL_REQUIRED", "Only a capitalized asset is adjusted; before that, correct its cost allocations.");
  const kind = String(input.kind ?? "").toUpperCase();
  if (!["CREDIT_NOTE", "ADDITIONAL_COST", "CORRECTION"].includes(kind)) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Choose the kind of adjustment.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Give the reason.", { field: "reason" });
  let amount = toCents(input.amount);
  let offset = null;
  let line = null;
  if (kind === "CORRECTION") {
    if (amount === 0n) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Enter the correction amount (negative to reduce the cost).", { field: "amount" });
    offset = input.offsetAccountId ? idOf(input.offsetAccountId, "Account", "ASSET_CAPITALIZATION_GL_MAPPING_MISSING") : null;
    if (!offset) throw capError(400, "ASSET_CAPITALIZATION_GL_MAPPING_MISSING", "Choose the Finance account on the other side of the correction.", { field: "offsetAccountId" });
  } else {
    line = await billLine(client, c, input.sourceLineId);
    const wanted = kind === "CREDIT_NOTE" ? "credit_note" : "bill";
    if (line.bill_type !== wanted || !POSTED_BILL.includes(line.bill_status)) throw capError(409, "ASSET_ACQUISITION_SOURCE_INVALID", `${line.bill_number} is not a posted ${kind === "CREDIT_NOTE" ? "supplier credit note" : "supplier bill"}.`);
    const left = toCents(line.net_amount) - (await usedOnLine(client, line.id, false));
    if (amount === 0n) amount = left;
    amount = amount < 0n ? -amount : amount;
    if (amount <= 0n || amount > left) throw capError(409, "ASSET_ACQUISITION_ALREADY_ALLOCATED", `Only ${centsText(left < 0n ? 0n : left)} of ${line.bill_number} is still unapplied.`);
    if (kind === "CREDIT_NOTE") amount = -amount;
    offset = line.expense_account_id;
  }
  if (a.capitalized_cost !== null && Number(a.capitalized_cost) + Number(centsText(amount)) < 0) throw capError(409, "ASSET_CAPITALIZATION_INVALID", "The adjustment would take the cost below zero.");
  const made = (await client.query(`INSERT INTO tenant.asset_capitalization_adjustments (organization_id, asset_id, capitalization_id, kind, source_type, source_line_id, amount, offset_account_id, reason, evidence, requested_by, command_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [c.organizationId, a.id, cap.id, kind, line ? "SUPPLIER_INVOICE_LINE" : "MANUAL", line?.id ?? null, centsText(amount), offset, reason,
    text(input.evidence, 500) || null, c.userId, command])).rows[0];
  await logCapEvent(client, c, "ADJUSTMENT_REQUESTED", { assetId: a.id, capitalizationId: cap.id, adjustmentId: made.id }, { kind, amount: centsText(amount) }, reason);
  await tell(client, c, CAP.post, `Adjustment ADJ-${made.adjustment_number} waits for Finance`, `${a.asset_number}: ${centsText(amount)}`, `/assets/capitalization?view=adjustments`);
  return { adjustmentId: made.id, number: `ADJ-${made.adjustment_number}`, status: made.status, amount: centsText(amount) };
}
// input: { decision: POST | REJECT, note? } — Finance (not the requester) posts it: the asset's cost moves by the amount, the journal moves
// it between the fixed-asset account and the source's account, and the remaining depreciation is recalculated from the new carrying value.
export async function decideCapitalizationAdjustment(client, c, adjustmentId, input = {}) {
  requireCap(c, CAP.post);
  const adj = (await client.query(`SELECT * FROM tenant.asset_capitalization_adjustments WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, idOf(adjustmentId, "Adjustment")])).rows[0];
  if (!adj) throw capError(404, "ASSET_CAPITALIZATION_NOT_FOUND", "That adjustment was not found.");
  if (adj.status !== "PENDING_REVIEW") return { adjustmentId: adj.id, status: adj.status, replayed: true };
  if (adj.requested_by === c.userId) throw capError(403, "ASSET_CAPITALIZATION_PERMISSION_DENIED", "The person who requested an adjustment cannot post it.");
  const decision = String(input.decision ?? "").toUpperCase();
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT") {
    if (!note) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Give the reason.", { field: "note" });
    await client.query(`UPDATE tenant.asset_capitalization_adjustments SET status = 'REJECTED', decided_by = $2, decided_at = clock_timestamp(), decision_note = $3 WHERE id = $1`, [adj.id, c.userId, note]);
    await logCapEvent(client, c, "ADJUSTMENT_REJECTED", { assetId: adj.asset_id, adjustmentId: adj.id }, {}, note);
    return { adjustmentId: adj.id, status: "REJECTED" };
  }
  if (decision !== "POST") throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Post or reject the adjustment.");
  const a = await loadCapAsset(client, c, adj.asset_id, { lock: true });
  if (!a.asset_account_id) throw capError(409, "ASSET_CAPITALIZATION_GL_MAPPING_MISSING");
  const amount = toCents(adj.amount);
  try {
    await client.query(`INSERT INTO tenant.asset_cost_components (organization_id, asset_id, component, source_type, source_line_id, method, amount, currency, reporting_amount, offset_account_id, capitalization_id, reason, created_by)
        VALUES ($1,$2,$3,$4,$5,'FULL',$6,$7,$6,$8,$9,$10,$11)`, [c.organizationId, a.id, adj.kind, adj.source_type, adj.source_line_id, centsText(amount), await baseCurrency(client, c), adj.offset_account_id, adj.capitalization_id, adj.reason, c.userId]);
  } catch (failure) { throw fromDb(failure); }
  let journalId = null;
  if (adj.offset_account_id !== a.asset_account_id) {
    const { postAssetJournal } = await import("../accounting-bridge.js");
    const abs = amount < 0n ? -amount : amount;
    const posted = await postAssetJournal(client, c, { date: todayIso(), reference: `ADJ-${adj.adjustment_number}`, description: `Capitalized cost adjustment of ${a.asset_number}`, sourceType: "asset_capitalization_adjustment",
      sourceId: adj.id, sourceNumber: `ADJ-${adj.adjustment_number}`,
      lines: amount > 0n ? [{ accountId: a.asset_account_id, debitCents: abs, description: a.name }, { accountId: adj.offset_account_id, creditCents: abs, description: adj.reason }]
        : [{ accountId: adj.offset_account_id, debitCents: abs, description: adj.reason }, { accountId: a.asset_account_id, creditCents: abs, description: a.name }] }).catch((failure) => {
      if (/Fiscal period|No fiscal period covers/i.test(String(failure?.message))) throw capError(409, "ASSET_CAPITALIZATION_PERIOD_CLOSED");
      throw failure;
    });
    if (posted.status !== "posted") throw capError(409, "ASSET_CAPITALIZATION_GL_MAPPING_MISSING");
    journalId = posted.journalEntryId;
  }
  await client.query(`UPDATE tenant.asset_capitalization_adjustments SET status = 'POSTED', decided_by = $2, decided_at = clock_timestamp(), decision_note = $3, journal_entry_id = $4 WHERE id = $1`, [adj.id, c.userId, note, journalId]);
  const updated = (await client.query(`UPDATE tenant.assets SET capitalized_cost = capitalized_cost + $3::numeric, net_book_value = net_book_value + $3::numeric WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [c.organizationId, a.id, centsText(amount)])).rows[0];
  await (await import("../asset-depreciation/dp-commands.js")).onCostAdjusted(client, c, updated.id, { adjustmentId: adj.id });
  await recordAssetEvent(client, c, a.id, "asset.capitalization_adjusted", { adjustmentId: adj.id, kind: adj.kind, amount: centsText(amount), journalEntryId: journalId });
  await logCapEvent(client, c, "ADJUSTMENT_POSTED", { assetId: a.id, capitalizationId: adj.capitalization_id, adjustmentId: adj.id }, { amount: centsText(amount), journalEntryId: journalId }, note);
  return { adjustmentId: adj.id, status: "POSTED", journalEntryId: journalId, capitalizedCost: String(updated.capitalized_cost) };
}

// ------------------------------------------------------------------ returns before capitalization
// input: { reason } — the purchase is returned to the supplier before it was capitalized: the unit is released from its purchase line, its
// cost allocations are reversed, any open request is withdrawn, and the asset is retired as returned. A capitalized asset is corrected
// through a credit-note adjustment instead.
export async function recordAcquisitionReturn(client, c, assetId, input = {}) {
  requireAnyCap(c, [CAP.register, CAP.bulkRegister]);
  const a = await loadCapAsset(client, c, assetId, { lock: true });
  if (a.capitalization_class === "CAPITALIZED") throw capError(409, "ASSET_CAPITALIZATION_ALREADY_POSTED", "This asset is capitalized; the return is a supplier credit-note adjustment.");
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw capError(400, "ASSET_CAPITALIZATION_INVALID", "Give the reason (and the return reference).", { field: "reason" });
  if (["RETIRED", "DISPOSED"].includes(a.lifecycle_status)) throw capError(409, "ASSET_CAPITALIZATION_INVALID", "This asset is no longer in service.");
  await client.query(`UPDATE tenant.asset_acquisition_allocations SET status = 'REVERSED', reversed_by = $2, reversed_at = clock_timestamp(), reversal_reason = $3 WHERE asset_id = $1 AND status = 'ACTIVE'`, [a.id, c.userId, `Returned to supplier: ${reason}`]);
  await client.query(`UPDATE tenant.asset_cost_components SET status = 'REVERSED', reversed_by = $2, reversed_at = clock_timestamp(), reversal_reason = $3 WHERE asset_id = $1 AND status = 'ACTIVE' AND capitalization_id IS NULL`, [a.id, c.userId, `Returned to supplier: ${reason}`]);
  await client.query(`UPDATE tenant.asset_capitalizations SET status = 'REJECTED', rejection_reason = $2 WHERE asset_id = $1 AND status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED')`, [a.id, `Returned to supplier: ${reason}`]);
  const { withStatusContext } = await import("../asset-status/status-commands.js");
  await withStatusContext(client, c, { action: "return", reason: `Returned to supplier: ${reason}` }, () => client.query(`UPDATE tenant.assets SET lifecycle_status = 'RETIRED', retired_at = clock_timestamp(), availability_status = 'RESTRICTED',
      current_user_id = NULL WHERE organization_id = $1 AND id = $2`, [c.organizationId, a.id]));
  await recordAssetEvent(client, c, a.id, "asset.returned_to_supplier", { reason });
  await logCapEvent(client, c, "RETURNED", { assetId: a.id }, {}, reason);
  return { assetId: a.id, status: "RETIRED" };
}
export { LIVE as LIVE_CAPITALIZATION };
export const _internal = { split, has };
