// The Sales + CRM bridge: a customer's page shows its open deals only while CRM is on, and only those the person may see there.
import { appOn } from "../../../core/access/apps.js";
import { listVisibleOpenDeals } from "../../crm/opportunities/records.js";

export const crmOn = (client, context) => appOn(client, context, "crm");

// The customer's open deals the person may see, or null when CRM is off.
export async function openDealsForCustomer(client, context, partyId) {
  if (!(await crmOn(client, context))) return null;
  return listVisibleOpenDeals(client, context, partyId);
}
