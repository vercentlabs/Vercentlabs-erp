// Physical control (F260/F261): verification campaigns reconcile what is scanned in the field to the
// register. A campaign snapshots the expected assets, each scan classifies the asset (matched, moved,
// damaged, unexpected), unscanned assets become missing, and every discrepancy is resolved through an
// explicit, separately-authorised command before the campaign can close.
import { AssetError, dateOrNull, loadAsset, need, nextNumber, oneOf, qx, recordAssetEvent, requiredText, textOrNull, today, uuid, uuidOrNull } from "./common.js";

export async function listVerificationCampaigns(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { values.push(String(filters.status)); where += ` AND k.status=$${values.length}`; }
  const res = await qx(client,
    `SELECT k.*,(SELECT count(*)::int FROM tenant.asset_verification_lines l WHERE l.campaign_id=k.id AND l.result='matched') AS matched,
       (SELECT count(*)::int FROM tenant.asset_verification_lines l WHERE l.campaign_id=k.id AND l.result NOT IN ('matched','pending')) AS discrepancies,
       (SELECT count(*)::int FROM tenant.asset_verification_lines l WHERE l.campaign_id=k.id AND l.result='pending') AS pending
     FROM tenant.asset_verification_campaigns k WHERE k.organization_id=$1 AND k.company_id=$2${where} ORDER BY k.created_at DESC LIMIT 200`, values);
  return res.rows;
}

export async function getVerificationCampaign(client, c, campaignId) {
  need(c, "assets.view");
  const k = (await qx(client, `SELECT * FROM tenant.asset_verification_campaigns WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(campaignId, "Campaign")])).rows[0];
  if (!k) throw new AssetError(404, "Campaign was not found.", "ASSET_NOT_FOUND");
  const lines = await qx(client, `SELECT l.*,a.asset_number,a.name AS asset_name,el.name AS expected_location_name,fl.name AS found_location_name FROM tenant.asset_verification_lines l LEFT JOIN tenant.assets a ON a.id=l.asset_id LEFT JOIN tenant.asset_locations el ON el.id=l.expected_location_id LEFT JOIN tenant.asset_locations fl ON fl.id=l.found_location_id WHERE l.organization_id=$1 AND l.campaign_id=$2 ORDER BY l.result,a.asset_number`, [c.organizationId, k.id]);
  const summary = { expected: k.expected_count, matched: 0, moved: 0, missing: 0, unexpected: 0, damaged: 0, pending: 0 };
  for (const l of lines.rows) summary[l.result] = (summary[l.result] || 0) + 1;
  return { campaign: k, lines: lines.rows, summary };
}

export async function createVerificationCampaign(client, c, input) {
  need(c, "assets.inspect");
  const number = await nextNumber(client, c, "asset_verification", "VER");
  const res = await qx(client, `INSERT INTO tenant.asset_verification_campaigns(organization_id,company_id,campaign_number,name,location_id,department_id,category_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [c.organizationId, c.companyId, number, requiredText(input.name, "Name", 200), uuidOrNull(input.locationId, "Location"), uuidOrNull(input.departmentId, "Department"), uuidOrNull(input.categoryId, "Category"), c.userId]);
  return res.rows[0];
}

export async function startVerificationCampaign(client, c, campaignId) {
  need(c, "assets.inspect");
  const k = (await qx(client, `SELECT * FROM tenant.asset_verification_campaigns WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(campaignId, "Campaign")])).rows[0];
  if (!k) throw new AssetError(404, "Campaign was not found.", "ASSET_NOT_FOUND");
  if (k.status !== "draft") throw new AssetError(409, "Only a draft campaign can be started.", "ASSET_STATE_INVALID");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (k.location_id) {
    values.push(k.location_id);
    where += ` AND a.location_id IN (WITH RECURSIVE t AS (SELECT id FROM tenant.asset_locations WHERE id=$${values.length} UNION ALL SELECT l.id FROM tenant.asset_locations l JOIN t ON l.parent_id=t.id) SELECT id FROM t)`;
  }
  if (k.department_id) { values.push(k.department_id); where += ` AND a.current_department_id=$${values.length}`; }
  if (k.category_id) { values.push(k.category_id); where += ` AND a.category_id=$${values.length}`; }
  const expected = await client.query(`SELECT a.id,a.location_id,a.current_user_id FROM tenant.assets a WHERE a.organization_id=$1 AND a.company_id=$2 AND a.status NOT IN ('draft','disposed','pending_disposal')${where}`, values);
  if (!expected.rows.length) throw new AssetError(409, "No assets fall inside the campaign scope.", "ASSET_CAMPAIGN_EMPTY");
  for (const a of expected.rows) await client.query(`INSERT INTO tenant.asset_verification_lines(organization_id,company_id,campaign_id,asset_id,expected_location_id,expected_user_id) VALUES($1,$2,$3,$4,$5,$6)`, [c.organizationId, c.companyId, k.id, a.id, a.location_id, a.current_user_id]);
  return (await qx(client, `UPDATE tenant.asset_verification_campaigns SET status='in_progress',expected_count=$2,started_by=$3,started_at=now() WHERE id=$1 RETURNING *`, [k.id, expected.rows.length, c.userId])).rows[0];
}

// A scan: the tag resolves to an asset (or to nothing). Server-side, so a stale mobile queue can never bypass state.
export async function scanVerificationAsset(client, c, campaignId, input) {
  need(c, "assets.inspect");
  const k = (await qx(client, `SELECT * FROM tenant.asset_verification_campaigns WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(campaignId, "Campaign")])).rows[0];
  if (!k) throw new AssetError(404, "Campaign was not found.", "ASSET_NOT_FOUND");
  if (k.status !== "in_progress") throw new AssetError(409, "Scans are accepted only while the campaign is in progress.", "ASSET_STATE_INVALID");
  const tag = requiredText(input.tag, "Tag", 200);
  const foundLocation = uuidOrNull(input.foundLocationId, "Location");
  const condition = input.condition ? oneOf(input.condition, ["excellent", "good", "fair", "poor", "critical"], "Condition") : null;
  const asset = (await qx(client, `SELECT * FROM tenant.assets WHERE organization_id=$1 AND company_id=$2 AND (tag_code=$3 OR asset_number=$3 OR serial_number=$3)`, [c.organizationId, c.companyId, tag])).rows[0];
  let line = asset ? (await qx(client, `SELECT * FROM tenant.asset_verification_lines WHERE campaign_id=$1 AND asset_id=$2 FOR UPDATE`, [k.id, asset.id])).rows[0] : null;
  let result;
  if (!asset) result = "unexpected";
  else if (!line) result = "unexpected";
  else if (condition && ["poor", "critical"].includes(condition)) result = "damaged";
  else if (foundLocation && line.expected_location_id && foundLocation !== line.expected_location_id) result = "moved";
  else result = "matched";
  const resolution = result === "matched" ? "none" : "open";
  if (line) {
    line = (await qx(client, `UPDATE tenant.asset_verification_lines SET result=$2,found_location_id=COALESCE($3,expected_location_id),found_condition=$4,resolution_status=$5,scanned_by=$6,scanned_at=now(),scanned_tag=$7 WHERE id=$1 RETURNING *`, [line.id, result, foundLocation, condition, resolution, c.userId, tag])).rows[0];
  } else {
    line = (await qx(client, `INSERT INTO tenant.asset_verification_lines(organization_id,company_id,campaign_id,asset_id,scanned_tag,found_location_id,found_condition,result,resolution_status,scanned_by,scanned_at) VALUES($1,$2,$3,$4,$5,$6,$7,'unexpected','open',$8,now()) RETURNING *`, [c.organizationId, c.companyId, k.id, asset?.id ?? null, tag, foundLocation, condition, c.userId])).rows[0];
  }
  return { ...line, matched_asset: asset ? { id: asset.id, asset_number: asset.asset_number, name: asset.name } : null };
}

export async function resolveVerificationDiscrepancy(client, c, lineId, input) {
  need(c, "assets.inspect");
  const line = (await qx(client, `SELECT * FROM tenant.asset_verification_lines WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(lineId, "Line")])).rows[0];
  if (!line) throw new AssetError(404, "Line was not found.", "ASSET_NOT_FOUND");
  const k = (await qx(client, `SELECT status FROM tenant.asset_verification_campaigns WHERE id=$1`, [line.campaign_id])).rows[0];
  if (k.status !== "in_progress") throw new AssetError(409, "The campaign is not open.", "ASSET_STATE_INVALID");
  if (line.resolution_status !== "open") throw new AssetError(409, "That line has no open discrepancy.", "ASSET_STATE_INVALID");
  const action = oneOf(input.action, ["update_location", "mark_lost", "accept", "dismiss"], "Action");
  const note = requiredText(input.note, "Resolution note", 500);
  if (action === "update_location") {
    need(c, "assets.manage");
    if (!line.asset_id || !line.found_location_id) throw new AssetError(409, "There is no found location to apply.", "ASSET_STATE_INVALID");
    const a = await loadAsset(client, c, line.asset_id, { lock: true });
    await client.query(`INSERT INTO tenant.asset_movements(organization_id,company_id,asset_id,movement_type,effective_date,from_location_id,to_location_id,reference_type,reference_id,reason,actor_user_id) VALUES($1,$2,$3,'verification_correction',$4,$5,$6,'asset_verification_line',$7,$8,$9)`, [c.organizationId, c.companyId, a.id, today(), a.location_id, line.found_location_id, line.id, note, c.userId]);
    await client.query(`UPDATE tenant.assets SET location_id=$2,updated_at=now() WHERE id=$1`, [a.id, line.found_location_id]);
    await recordAssetEvent(client, c, a.id, "asset.location_corrected", { lineId: line.id });
  } else if (action === "mark_lost") {
    need(c, "assets.manage");
    if (!line.asset_id) throw new AssetError(409, "There is no asset to mark as lost.", "ASSET_STATE_INVALID");
    const a = await loadAsset(client, c, line.asset_id, { lock: true });
    if (["disposed", "draft"].includes(a.status)) throw new AssetError(409, "That asset cannot be marked lost.", "ASSET_STATE_INVALID");
    await client.query(`UPDATE tenant.assets SET status='lost',updated_at=now() WHERE id=$1`, [a.id]);
    await client.query(`INSERT INTO tenant.asset_movements(organization_id,company_id,asset_id,movement_type,effective_date,reference_type,reference_id,reason,actor_user_id) VALUES($1,$2,$3,'status_change',$4,'asset_verification_line',$5,$6,$7)`, [c.organizationId, c.companyId, a.id, today(), line.id, `Lost: ${note}`, c.userId]);
    await recordAssetEvent(client, c, a.id, "asset.marked_lost", { lineId: line.id });
  }
  return (await qx(client, `UPDATE tenant.asset_verification_lines SET resolution_status='resolved',resolution_note=$2 WHERE id=$1 RETURNING *`, [line.id, `${action}: ${note}`])).rows[0];
}

export async function closeVerificationCampaign(client, c, campaignId, input = {}) {
  need(c, "assets.inspect");
  const k = (await qx(client, `SELECT * FROM tenant.asset_verification_campaigns WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(campaignId, "Campaign")])).rows[0];
  if (!k) throw new AssetError(404, "Campaign was not found.", "ASSET_NOT_FOUND");
  if (k.status !== "in_progress") throw new AssetError(409, "Only a campaign in progress can be closed.", "ASSET_STATE_INVALID");
  const pending = (await client.query(`SELECT count(*)::int AS n FROM tenant.asset_verification_lines WHERE campaign_id=$1 AND result='pending'`, [k.id])).rows[0].n;
  if (pending > 0) {
    if (input.markRemainingMissing !== true) throw new AssetError(409, `${pending} expected asset(s) were not scanned; scan them or close with the remainder marked missing.`, "ASSET_CAMPAIGN_UNSCANNED");
    await client.query(`UPDATE tenant.asset_verification_lines SET result='missing',resolution_status='open' WHERE campaign_id=$1 AND result='pending'`, [k.id]);
  }
  const open = (await client.query(`SELECT count(*)::int AS n FROM tenant.asset_verification_lines WHERE campaign_id=$1 AND resolution_status='open'`, [k.id])).rows[0].n;
  if (open > 0) throw new AssetError(409, `${open} discrepancy(ies) are still unresolved; resolve each before closing.`, "ASSET_CAMPAIGN_OPEN_DISCREPANCIES");
  return (await qx(client, `UPDATE tenant.asset_verification_campaigns SET status='closed',closed_by=$2,closed_at=now() WHERE id=$1 RETURNING *`, [k.id, c.userId])).rows[0];
}

export async function cancelVerificationCampaign(client, c, campaignId) {
  need(c, "assets.inspect");
  const res = await qx(client, `UPDATE tenant.asset_verification_campaigns SET status='cancelled' WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status IN ('draft','in_progress') RETURNING *`, [c.organizationId, c.companyId, uuid(campaignId, "Campaign")]);
  if (!res.rows[0]) throw new AssetError(409, "Only an open campaign can be cancelled.", "ASSET_STATE_INVALID");
  return res.rows[0];
}

void dateOrNull;
void textOrNull;
