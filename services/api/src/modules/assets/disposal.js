// Disposal and retirement (F262-F266): sale, scrap, write-off, donation and return-to-vendor share one
// approved workflow (request, approve by someone else, complete). Completion computes gain or loss from
// the live carrying value, refuses while earlier depreciation is unposted, hands one balanced journal to
// Accounting, and retires the asset for good.
import { AssetError, dateRequired, fromCents, loadAsset, loadSettings, need, nextNumber, nonNegative, oneOf, qx, recordAssetEvent, requiredText, textOrNull, toCents, today, uuid, uuidOrNull } from "./common.js";
import { postAssetJournal } from "./accounting-bridge.js";

const DISPOSABLE = ["available", "assigned", "in_maintenance", "retired", "lost"];

export async function listDisposals(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { values.push(String(filters.status)); where += ` AND d.status=$${values.length}`; }
  if (filters.group === "sale") where += ` AND d.disposal_method IN ('sale','return_to_vendor')`;
  if (filters.group === "retire") where += ` AND d.disposal_method IN ('scrap','write_off','donation')`;
  const res = await qx(client, `SELECT d.*,a.asset_number,a.name AS asset_name FROM tenant.asset_disposals d JOIN tenant.assets a ON a.id=d.asset_id WHERE d.organization_id=$1 AND d.company_id=$2${where} ORDER BY d.created_at DESC LIMIT 300`, values);
  return res.rows;
}

export async function requestDisposal(client, c, assetId, input) {
  need(c, "assets.dispose");
  const a = await loadAsset(client, c, assetId, { lock: true });
  if (!DISPOSABLE.includes(a.status)) throw new AssetError(409, "Only a capitalized asset that is not already being disposed can be disposed.", "ASSET_STATE_INVALID");
  const method = oneOf(input.disposalMethod, ["sale", "scrap", "write_off", "donation", "return_to_vendor"], "Disposal method");
  const proceeds = nonNegative(input.proceedsAmount, "Proceeds");
  if (method === "sale") {
    if (!uuidOrNull(input.buyerPartyId, "Buyer")) throw new AssetError(400, "A sale needs a buyer.", "ASSET_FIELD_REQUIRED");
    if (proceeds <= 0) throw new AssetError(400, "A sale needs proceeds greater than zero.", "ASSET_NUMBER_INVALID");
  } else if (["write_off", "donation"].includes(method) && proceeds > 0) throw new AssetError(400, `A ${method.replace("_", "-")} has no proceeds.`, "ASSET_NUMBER_INVALID");
  const running = await client.query(`SELECT 1 FROM tenant.asset_maintenance_orders WHERE asset_id=$1 AND status='in_progress'`, [a.id]);
  if (running.rows[0]) throw new AssetError(409, "Finish or cancel the work order in progress before disposing of this asset.", "ASSET_HAS_OPEN_WORK");
  const children = await client.query(`SELECT count(*)::int AS n FROM tenant.assets WHERE parent_asset_id=$1 AND status NOT IN ('disposed')`, [a.id]);
  if (children.rows[0].n > 0) throw new AssetError(409, "This asset has component assets; dispose of or detach them first.", "ASSET_HAS_COMPONENTS");
  const number = await nextNumber(client, c, "asset_disposal", "DSP");
  const d = (await qx(client,
    `INSERT INTO tenant.asset_disposals(organization_id,company_id,asset_id,disposal_number,disposal_date,disposal_method,proceeds_amount,disposal_cost,net_book_value,gain_loss_amount,buyer_party_id,reason,status,requested_by,previous_status,sale_reference)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,'pending_approval',$12,$13,$14) RETURNING *`,
    [c.organizationId, c.companyId, a.id, number, dateRequired(input.disposalDate || today(), "Disposal date"), method, String(proceeds), String(nonNegative(input.disposalCost, "Disposal cost")), a.net_book_value, uuidOrNull(input.buyerPartyId, "Buyer"), requiredText(input.reason, "Reason", 1000), c.userId, a.status, textOrNull(input.saleReference, 200)])).rows[0];
  await client.query(`UPDATE tenant.assets SET status='pending_disposal',updated_at=now() WHERE id=$1`, [a.id]);
  await recordAssetEvent(client, c, a.id, "asset.disposal_requested", { disposalId: d.id, method });
  return d;
}

async function lockDisposal(client, c, id) {
  const d = (await qx(client, `SELECT * FROM tenant.asset_disposals WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Disposal")])).rows[0];
  if (!d) throw new AssetError(404, "Disposal was not found.", "ASSET_NOT_FOUND");
  return d;
}

async function restoreAsset(client, d) {
  await client.query(`UPDATE tenant.assets SET status=COALESCE($2,'available'),updated_at=now() WHERE id=$1 AND status='pending_disposal'`, [d.asset_id, d.previous_status]);
}

export async function approveDisposal(client, c, disposalId) {
  need(c, "assets.accounting.handoff");
  const d = await lockDisposal(client, c, disposalId);
  if (d.status !== "pending_approval") throw new AssetError(409, "Only a pending disposal can be approved.", "ASSET_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && d.requested_by === c.userId) throw new AssetError(409, "The requester cannot approve their own disposal.", "SELF_APPROVAL_BLOCKED");
  return (await qx(client, `UPDATE tenant.asset_disposals SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1 RETURNING *`, [d.id, c.userId])).rows[0];
}

export async function rejectDisposal(client, c, disposalId, reason) {
  need(c, "assets.accounting.handoff");
  const d = await lockDisposal(client, c, disposalId);
  if (!["pending_approval", "approved"].includes(d.status)) throw new AssetError(409, "Only an open disposal can be rejected.", "ASSET_STATE_INVALID");
  const res = (await qx(client, `UPDATE tenant.asset_disposals SET status='rejected',rejected_reason=$2,approved_by=$3,approved_at=now() WHERE id=$1 RETURNING *`, [d.id, requiredText(reason, "Reason", 500), c.userId])).rows[0];
  await restoreAsset(client, d);
  return res;
}

export async function cancelDisposal(client, c, disposalId) {
  need(c, "assets.dispose");
  const d = await lockDisposal(client, c, disposalId);
  if (!["pending_approval", "approved"].includes(d.status) || d.requested_by !== c.userId) throw new AssetError(409, "Only your own open disposal can be cancelled.", "ASSET_STATE_INVALID");
  const res = (await qx(client, `UPDATE tenant.asset_disposals SET status='cancelled' WHERE id=$1 RETURNING *`, [d.id])).rows[0];
  await restoreAsset(client, d);
  return res;
}

export async function completeDisposal(client, c, disposalId) {
  need(c, "assets.dispose");
  const d = await lockDisposal(client, c, disposalId);
  if (d.status === "completed") return d;
  if (d.status !== "approved") throw new AssetError(409, "A disposal must be approved before it is completed.", "ASSET_STATE_INVALID");
  const a = await loadAsset(client, c, d.asset_id, { lock: true });
  const unposted = await client.query(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_schedules WHERE asset_id=$1 AND period_end<=$2 AND status IN ('planned','ready') AND depreciation_amount>0`, [a.id, d.disposal_date]);
  if (unposted.rows[0].n > 0) throw new AssetError(409, "Post the depreciation due up to the disposal date before completing this disposal.", "ASSET_DEPRECIATION_PENDING");
  const cost = toCents(a.capitalized_cost);
  const accDep = toCents(a.accumulated_depreciation) + toCents(a.impairment_accumulated);
  const nbv = cost - accDep;
  const net = toCents(d.proceeds_amount) - toCents(d.disposal_cost);
  const gainLoss = net - nbv;
  const cat = (await client.query(`SELECT * FROM tenant.asset_categories WHERE id=$1`, [a.category_id])).rows[0];
  const settings = await loadSettings(client, c);
  let accounting = { status: "not_required", journalEntryId: null };
  if (settings.post_to_accounting) {
    const lines = [{ accountId: cat.asset_account_id, creditCents: cost, description: `Derecognise ${a.asset_number}` }];
    if (accDep > 0n) lines.push({ accountId: cat.accumulated_depreciation_account_id, debitCents: accDep, description: "Clear accumulated depreciation" });
    if (net > 0n) lines.push({ accountId: cat.proceeds_account_id, debitCents: net, description: "Disposal proceeds (net of costs)" });
    if (net < 0n) lines.push({ accountId: cat.proceeds_account_id, creditCents: -net, description: "Disposal costs" });
    if (gainLoss > 0n) lines.push({ accountId: cat.gain_loss_account_id, creditCents: gainLoss, description: "Gain on disposal" });
    if (gainLoss < 0n) lines.push({ accountId: cat.gain_loss_account_id, debitCents: -gainLoss, description: "Loss on disposal" });
    accounting = await postAssetJournal(client, c, { date: String(d.disposal_date).slice(0, 10), reference: d.disposal_number, description: `Disposal ${d.disposal_number} of ${a.asset_number}`, sourceType: "asset_disposal", sourceId: d.id, sourceNumber: d.disposal_number, lines });
  }
  await client.query(`UPDATE tenant.asset_depreciation_schedules SET status='reversed' WHERE asset_id=$1 AND status IN ('planned','ready') AND run_id IS NULL`, [a.id]);
  await client.query(`UPDATE tenant.asset_assignments SET assignment_status='returned',returned_at=now(),returned_by=$2 WHERE asset_id=$1 AND assignment_status='active'`, [a.id, c.userId]);
  await client.query(`INSERT INTO tenant.asset_movements(organization_id,company_id,asset_id,movement_type,effective_date,from_user_id,from_department_id,from_location_id,reference_type,reference_id,reason,actor_user_id) VALUES($1,$2,$3,'status_change',$4,$5,$6,$7,'asset_disposal',$8,$9,$10)`, [c.organizationId, c.companyId, a.id, d.disposal_date, a.current_user_id, a.current_department_id, a.location_id, d.id, `Disposed (${d.disposal_method})`, c.userId]);
  await client.query(`UPDATE tenant.assets SET status='disposed',disposed_at=$2,current_user_id=NULL,current_department_id=NULL,current_cost_center_id=NULL,net_book_value=0,updated_at=now() WHERE id=$1`, [a.id, d.disposal_date]);
  const res = (await qx(client, `UPDATE tenant.asset_disposals SET status='completed',net_book_value=$2,gain_loss_amount=$3,original_cost=$4,accumulated_depreciation=$5,completed_by=$6,completed_at=now(),accounting_journal_id=$7,disposal_journal_status=$8 WHERE id=$1 RETURNING *`, [d.id, fromCents(nbv), fromCents(gainLoss), fromCents(cost), fromCents(accDep), c.userId, accounting.journalEntryId, accounting.status])).rows[0];
  await recordAssetEvent(client, c, a.id, "asset.disposed", { disposalId: d.id, gainLoss: fromCents(gainLoss), accounting: accounting.status });
  return res;
}
