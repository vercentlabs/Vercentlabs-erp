// The stage history of one lead, behind the lead's own visibility.
import { getLead } from "./records.js";
import { listLeadStageEntries } from "./stages.js";

export async function listLeadStageHistory(client, context, leadId) {
  const lead = await getLead(client, context, leadId);
  return listLeadStageEntries(client, context, lead.id);
}
