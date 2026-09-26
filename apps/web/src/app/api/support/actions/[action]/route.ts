import { z } from "zod";

import {
  saveSupportSettings, saveSupportCategory, saveSupportQueue, setQueueMember, removeQueueMember, saveRoutingRule, deactivateRoutingRule, saveSlaPolicy, deactivateSlaPolicy, saveEscalationPolicy,
  createTicket, updateTicket, assignTicket, transitionTicket, mergeTickets, addCommunication, removeAttachment, escalateTicket, decideEscalation, checkSlaBreaches,
  saveKnowledgeArticle, submitKnowledgeArticle, publishKnowledgeArticle, retireKnowledgeArticle, reviseKnowledgeArticle, rateKnowledgeArticle, linkArticleToTicket, saveCannedResponse, recordCannedResponseUsage,
  saveEntitlement, setEntitlementStatus, invitePortalUser, setPortalUserStatus,
  createMyTicket, replyToMyTicket, submitMyCsat,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { supportMutation } from "@/features/support/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const idOf = (input: Record<string, unknown>) => {
  const id = String(input.id ?? "");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};
// Customer portal self-service: no support permission on the route. The domain scopes each one to the
// caller's own linked customer party via support_portal_users.
const SELF_SERVICE = new Set(["my-ticket-create", "my-ticket-reply", "my-attachment-add", "my-csat-submit"]);

export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return supportMutation(
    request,
    body,
    async (client, context, input) => {
      switch (action) {
        case "settings-save":
          return { record: await saveSupportSettings(client, context, input) };
        case "category-save":
          return { record: await saveSupportCategory(client, context, input) };
        case "queue-save":
          return { record: await saveSupportQueue(client, context, input) };
        case "queue-member-set":
          return { record: await setQueueMember(client, context, input) };
        case "queue-member-remove":
          return { record: await removeQueueMember(client, context, String(input.queueId ?? ""), String(input.userId ?? "")) };
        case "routing-rule-save":
          return { record: await saveRoutingRule(client, context, input) };
        case "routing-rule-deactivate":
          return { record: await deactivateRoutingRule(client, context, idOf(input)) };
        case "sla-policy-save":
          return { record: await saveSlaPolicy(client, context, input) };
        case "sla-policy-deactivate":
          return { record: await deactivateSlaPolicy(client, context, idOf(input)) };
        case "escalation-policy-save":
          return { record: await saveEscalationPolicy(client, context, input) };
        case "ticket-create":
          return { record: await createTicket(client, context, input) };
        case "ticket-update":
          return { record: await updateTicket(client, context, idOf(input), input) };
        case "ticket-assign":
          return { record: await assignTicket(client, context, idOf(input), input) };
        case "ticket-transition":
          return { record: await transitionTicket(client, context, idOf(input), input) };
        case "ticket-merge":
          return { record: await mergeTickets(client, context, input) };
        case "communication-add":
          return { record: await addCommunication(client, context, String(input.ticketId ?? ""), input) };
        case "attachment-add":
          // Files carry bytes: upload through POST /api/support/tickets/{ticketId}/attachments.
          throw new HttpError(400, "Upload the file to the ticket's attachments endpoint.", "SUPPORT_ATTACHMENT_UPLOAD_REQUIRED");
        case "attachment-remove":
          return { record: await removeAttachment(client, context, idOf(input)) };
        case "escalation-raise":
          return { record: await escalateTicket(client, context, String(input.ticketId ?? ""), input) };
        case "escalation-decide":
          return { record: await decideEscalation(client, context, idOf(input), input) };
        case "sla-breach-check":
          return { record: await checkSlaBreaches(client, context) };
        case "article-save":
          return { record: await saveKnowledgeArticle(client, context, input) };
        case "article-submit":
          return { record: await submitKnowledgeArticle(client, context, idOf(input)) };
        case "article-publish":
          return { record: await publishKnowledgeArticle(client, context, idOf(input), input) };
        case "article-retire":
          return { record: await retireKnowledgeArticle(client, context, idOf(input), String(input.reason ?? "")) };
        case "article-revise":
          return { record: await reviseKnowledgeArticle(client, context, idOf(input)) };
        case "article-rate":
          return { record: await rateKnowledgeArticle(client, context, idOf(input), input.helpful === true) };
        case "article-link":
          return { record: await linkArticleToTicket(client, context, input) };
        case "canned-response-save":
          return { record: await saveCannedResponse(client, context, input) };
        case "canned-response-use":
          return { record: await recordCannedResponseUsage(client, context, idOf(input)) };
        case "entitlement-save":
          return { record: await saveEntitlement(client, context, input) };
        case "entitlement-status":
          return { record: await setEntitlementStatus(client, context, idOf(input), String(input.status ?? "")) };
        case "portal-user-invite":
          return { record: await invitePortalUser(client, context, input) };
        case "portal-user-status":
          return { record: await setPortalUserStatus(client, context, idOf(input), String(input.status ?? "")) };
        case "my-ticket-create":
          return { record: await createMyTicket(client, context, input) };
        case "my-ticket-reply":
          return { record: await replyToMyTicket(client, context, String(input.ticketId ?? ""), input) };
        case "my-attachment-add":
          throw new HttpError(400, "Upload the file to the ticket's attachments endpoint.", "SUPPORT_ATTACHMENT_UPLOAD_REQUIRED");
        case "my-csat-submit":
          return { record: await submitMyCsat(client, context, String(input.ticketId ?? ""), input) };
        default:
          throw new HttpError(404, "Unknown Support action.");
      }
    },
    200,
    SELF_SERVICE.has(action) ? "" : "support.view",
  );
}
