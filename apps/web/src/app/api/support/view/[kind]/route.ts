import {
  getSupportSettings,
  listSupportCategories,
  listTickets,
  getTicket,
  listCommunications,
  listAttachments,
  getTicketHistory,
  getSupportDeskDashboard,
  listSupportOptions,
  listCustomerContacts,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { supportRead } from "@/features/support/shared/route-helpers";

// One read endpoint per Support screen. Each is gated by support.view (module-wide) and the domain
// function re-checks its OWN permission.
// tickets serves both HR-scoped staff work (no scope) and a staff member's own queue (scope=mine)
const SCOPED = new Set(["tickets"]);

export async function GET(
  request: Request,
  ctx: { params: Promise<{ kind: string }> },
) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return supportRead(
    request,
    async (client, context) => {
      switch (kind) {
        case "options":
          return { options: await listSupportOptions(client, context) };
        case "settings":
          return { settings: await getSupportSettings(client, context) };
        case "categories":
          return { rows: await listSupportCategories(client, context) };
        case "tickets":
          return {
            rows: await listTickets(client, context, {
              status: get("status"),
              queueId: get("queueId"),
              assignedUserId: get("assignedUserId"),
              priority: get("priority"),
              customerId: get("customerId"),
              tag: get("tag"),
              scope: get("scope"),
              breachedOnly: get("breachedOnly") === "true",
            }),
          };
        case "ticket":
          return { ticket: await getTicket(client, context, get("id") ?? "") };
        case "communications":
          return {
            rows: await listCommunications(
              client,
              context,
              get("ticketId") ?? "",
            ),
          };
        case "attachments":
          return {
            rows: await listAttachments(client, context, get("ticketId") ?? ""),
          };
        case "ticket-history":
          return {
            history: await getTicketHistory(
              client,
              context,
              get("ticketId") ?? "",
            ),
          };
        case "customer-contacts":
          return {
            rows: await listCustomerContacts(
              client,
              context,
              get("partyId") ?? "",
            ),
          };
        case "dashboard":
          return { dashboard: await getSupportDeskDashboard(client, context) };
        default:
          throw new HttpError(404, "Unknown Support view.");
      }
    },
    SCOPED.has(kind) && q.get("scope") === "mine" ? "" : "support.view",
  );
}
