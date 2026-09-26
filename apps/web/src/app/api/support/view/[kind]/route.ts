import {
  getSupportSettings, listSupportCategories, listSupportQueues, listQueueMembers, listRoutingRules, listSlaPolicies, listEscalationPolicies,
  listTickets, getTicket, listCommunications, listAttachments, listEscalations, getTicketHistory,
  listKnowledgeArticles, getKnowledgeArticle, listTicketKnowledgeLinks, listCannedResponses,
  getMyPortalAccess, listMyTickets, getMyTicket, listMyCommunications, listMyAttachments, listMyKnowledgeArticles, getMyKnowledgeArticle,
  getCustomerOrderHistory, getTicketLinkedRecords, listEntitlements, getCsatReport, getAgentPerformance, getSlaReport, getSupportDeskDashboard, getSupportAuditLog, listSupportOptions, listCustomerContacts, listPortalUsers,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { supportRead } from "@/features/support/shared/route-helpers";

// One read endpoint per Support screen. Each is gated by support.view (module-wide) and the domain
// function re-checks its OWN permission; the "my-*" views are customer-portal self-service, scoped to
// the caller's own linked customer party.
const SELF_SERVICE = new Set(["my-tickets", "my-ticket", "my-communications", "my-attachments", "my-portal-access", "my-knowledge-articles", "my-knowledge-article"]);
// tickets serves both HR-scoped staff work (no scope) and a staff member's own queue (scope=mine)
const SCOPED = new Set(["tickets"]);

export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return supportRead(request, async (client, context) => {
    switch (kind) {
      case "options":
        return { options: await listSupportOptions(client, context) };
      case "settings":
        return { settings: await getSupportSettings(client, context) };
      case "categories":
        return { rows: await listSupportCategories(client, context) };
      case "queues":
        return { rows: await listSupportQueues(client, context) };
      case "queue-members":
        return { rows: await listQueueMembers(client, context, get("queueId") ?? "") };
      case "routing-rules":
        return { rows: await listRoutingRules(client, context) };
      case "sla-policies":
        return { rows: await listSlaPolicies(client, context) };
      case "escalation-policies":
        return { rows: await listEscalationPolicies(client, context) };
      case "tickets":
        return { rows: await listTickets(client, context, { status: get("status"), queueId: get("queueId"), assignedUserId: get("assignedUserId"), priority: get("priority"), customerId: get("customerId"), tag: get("tag"), scope: get("scope"), breachedOnly: get("breachedOnly") === "true" }) };
      case "ticket":
        return { ticket: await getTicket(client, context, get("id") ?? "") };
      case "communications":
        return { rows: await listCommunications(client, context, get("ticketId") ?? "") };
      case "attachments":
        return { rows: await listAttachments(client, context, get("ticketId") ?? "") };
      case "escalations":
        return { rows: await listEscalations(client, context, { status: get("status") }) };
      case "ticket-history":
        return { history: await getTicketHistory(client, context, get("ticketId") ?? "") };
      case "ticket-linked-records":
        return { linked: await getTicketLinkedRecords(client, context, get("ticketId") ?? "") };
      case "knowledge-articles":
        return { rows: await listKnowledgeArticles(client, context, { status: get("status"), visibility: get("visibility"), categoryId: get("categoryId"), search: get("search") }) };
      case "knowledge-article":
        return { article: await getKnowledgeArticle(client, context, get("id") ?? "") };
      case "ticket-knowledge-links":
        return { rows: await listTicketKnowledgeLinks(client, context, get("ticketId") ?? "") };
      case "canned-responses":
        return { rows: await listCannedResponses(client, context, { categoryId: get("categoryId") }) };
      case "entitlements":
        return { rows: await listEntitlements(client, context, { partyId: get("partyId") }) };
      case "portal-users":
        return { rows: await listPortalUsers(client, context, get("partyId")) };
      case "customer-order-history":
        return { rows: await getCustomerOrderHistory(client, context, get("partyId") ?? "") };
      case "customer-contacts":
        return { rows: await listCustomerContacts(client, context, get("partyId") ?? "") };
      case "csat-report":
        return { report: await getCsatReport(client, context, { from: get("from"), to: get("to") }) };
      case "agent-performance":
        return { rows: await getAgentPerformance(client, context, { from: get("from"), to: get("to") }) };
      case "sla-report":
        return { report: await getSlaReport(client, context, { from: get("from"), to: get("to") }) };
      case "dashboard":
        return { dashboard: await getSupportDeskDashboard(client, context) };
      case "audit-log":
        return { rows: await getSupportAuditLog(client, context, { ticketId: get("ticketId"), eventType: get("eventType") }) };
      case "my-portal-access":
        return { access: await getMyPortalAccess(client, context) };
      case "my-tickets":
        return { rows: await listMyTickets(client, context, { status: get("status") }) };
      case "my-ticket":
        return { ticket: await getMyTicket(client, context, get("id") ?? "") };
      case "my-communications":
        return { rows: await listMyCommunications(client, context, get("ticketId") ?? "") };
      case "my-attachments":
        return { rows: await listMyAttachments(client, context, get("ticketId") ?? "") };
      case "my-knowledge-articles":
        return { rows: await listMyKnowledgeArticles(client, context, {}) };
      case "my-knowledge-article":
        return { article: await getMyKnowledgeArticle(client, context, get("id") ?? "") };
      default:
        throw new HttpError(404, "Unknown Support view.");
    }
  }, SELF_SERVICE.has(kind) || (SCOPED.has(kind) && q.get("scope") === "mine") ? "" : "support.view");
}
