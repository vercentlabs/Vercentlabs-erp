import { z } from "zod";

import {
  saveSupportSettings,
  saveSupportCategory,
  createTicket,
  updateTicket,
  assignTicket,
  transitionTicket,
  addCommunication,
  removeAttachment,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { supportMutation } from "@/features/support/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const idOf = (input: Record<string, unknown>) => {
  const id = String(input.id ?? "");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> },
) {
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
        case "ticket-create":
          return { record: await createTicket(client, context, input) };
        case "ticket-update":
          return {
            record: await updateTicket(client, context, idOf(input), input),
          };
        case "ticket-assign":
          return {
            record: await assignTicket(client, context, idOf(input), input),
          };
        case "ticket-transition":
          return {
            record: await transitionTicket(client, context, idOf(input), input),
          };
        case "communication-add":
          return {
            record: await addCommunication(
              client,
              context,
              String(input.ticketId ?? ""),
              input,
            ),
          };
        case "attachment-add":
          // Files carry bytes: upload through POST /api/support/tickets/{ticketId}/attachments.
          throw new HttpError(
            400,
            "Upload the file to the ticket's attachments endpoint.",
            "SUPPORT_ATTACHMENT_UPLOAD_REQUIRED",
          );
        case "attachment-remove":
          return {
            record: await removeAttachment(client, context, idOf(input)),
          };
        default:
          throw new HttpError(404, "Unknown Support action.");
      }
    },
    200,
    "support.view",
  );
}
