import { z } from "zod";
import { runBroadcasts } from "@vercentlabs/api/crm";

export const JOB_TYPE = "crm.whatsapp_broadcasts.send";

export const payloadSchema = z.object({}).strict();

// CRM audit M2: due WhatsApp broadcasts start, and up to 50 of their recipients are messaged per tick. Each recipient is claimed (FOR
// UPDATE SKIP LOCKED) and marked sent or failed in the same transaction, so an overlapping tick never messages anyone twice.
export async function whatsAppBroadcastsSendHandler(client, context) {
  return runBroadcasts(client, context.organizationId);
}
