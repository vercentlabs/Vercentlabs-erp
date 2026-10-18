import { z } from "zod";
import { syncCalendars } from "@vercentlabs/api/crm";

export const JOB_TYPE = "crm.calendar.sync";

export const payloadSchema = z.object({}).strict();

// CRM plan 4.5: keeps each connected Google / Outlook calendar up to date with its owner's CRM meetings. Each event is mapped to its
// activity (crm_calendar_events) and changed only when the meeting changed, so a re-run adds nothing twice; a failing connection is
// marked on itself and the others still sync.
export async function calendarSyncHandler(client, context) {
  return syncCalendars(client, context.organizationId);
}
