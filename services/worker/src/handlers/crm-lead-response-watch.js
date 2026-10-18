import { z } from "zod";
import { runLeadResponseWatch } from "@vercentlabs/api/crm";

export const JOB_TYPE = "crm.leads.response_watch";

export const payloadSchema = z.object({}).strict();

// CRM plan 3.5: first-response alerts and their escalation, overdue follow-up notices, overdue work escalated to managers, and the
// scheduled re-run of assignment for unassigned leads. Each notice is stamped when its row is claimed, so a re-run never repeats one.
export async function leadResponseWatchHandler(client, context) {
  return runLeadResponseWatch(client, context.organizationId);
}
