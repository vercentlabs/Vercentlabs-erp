// Custody (F239-F241): the older assignment list. Movement history is Asset Movement History's (asset-movements/), derived from the source records.
import { need, qx, uuid } from "./common.js";

// Issuing and returning assets is the Custodian workflow's (asset-custody/); the older assignment and return commands are retired.
export async function listAssignments(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId];
  let where = "";
  if (filters.status) { values.push(String(filters.status)); where += ` AND asg.assignment_status=$${values.length}`; }
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND asg.asset_id=$${values.length}`; }
  const res = await qx(client, `SELECT asg.*,a.asset_number,a.name AS asset_name,usr.full_name AS custodian_name FROM tenant.asset_assignments asg JOIN tenant.assets a ON a.id=asg.asset_id LEFT JOIN public.users usr ON usr.id=asg.assigned_to_user_id WHERE asg.organization_id=$1${where} ORDER BY asg.assigned_from DESC LIMIT 300`, values);
  return res.rows;
}

// Transfers are Asset Transfers' (asset-transfers/): dispatched, received and completed, through the location record and the Custodian handover.
