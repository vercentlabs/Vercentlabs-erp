import { z } from "zod";
import { refreshLeadScoringHistory } from "@vercentlabs/api/crm";

export const JOB_TYPE = "crm.lead_scoring.learn";

export const payloadSchema = z.object({}).strict();

// Once a day, lead scoring learns again from the last year's closed leads (Line-by-line audit P11): each lead saved during the day reads
// what was learned instead of scanning a year of leads.
export async function leadScoringHistoryHandler(client, context) {
  return refreshLeadScoringHistory(client, context.organizationId);
}
