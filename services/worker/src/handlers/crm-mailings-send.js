import { z } from "zod";
import { runMailings } from "@vercentlabs/api/crm";

export const JOB_TYPE = "crm.mailings.send";

export const payloadSchema = z.object({}).strict();

// CRM plan 5.8: due campaign emails start, and up to 50 of their recipients are emailed per tick. Each recipient is claimed (FOR UPDATE
// SKIP LOCKED) and marked sent or failed in the same transaction, so an overlapping tick never emails anyone twice.
export async function mailingsSendHandler(client, context) {
  return runMailings(client, context.organizationId);
}
