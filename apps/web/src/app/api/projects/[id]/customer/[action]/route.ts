import {
  clearProjectCustomerReview, getCustomerAssociationHistory, listEligibleProjectContacts, previewProjectCustomerChange, requestProjectCustomerChange, resolveProjectCustomerMapping,
  setProjectPrimaryContact,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string; action: string }> };
// GET history · change-preview?toCustomerId= · eligible-contacts?search=
export async function GET(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return projectsRead(request, async (client, context, url) => {
    switch (action) {
      case "history": return { history: await getCustomerAssociationHistory(client, context, id) };
      case "change-preview": return { review: await previewProjectCustomerChange(client, context, id, url.searchParams.get("toCustomerId") ?? "") };
      case "eligible-contacts": return { contacts: await listEligibleProjectContacts(client, context, id, url.searchParams.get("search") ?? "") };
      default: throw new HttpError(404, "Unknown customer view.", "NOT_FOUND");
    }
  });
}
const schema = z.object({
  toCustomerId: z.string().uuid().optional(), toContactId: z.string().uuid().optional(), contactId: z.string().uuid().nullable().optional(), reason: z.string().max(2000).optional(),
  note: z.string().max(1000).optional(), acknowledgeWarnings: z.boolean().optional(), correction: z.boolean().optional(), expectedVersion: z.number().int().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
// POST change-request · primary-contact · resolve-mapping · clear-review
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "change-request": return requestProjectCustomerChange(client, context, id, input);
      case "primary-contact": return setProjectPrimaryContact(client, context, id, input);
      case "resolve-mapping": return resolveProjectCustomerMapping(client, context, id, input);
      case "clear-review": return clearProjectCustomerReview(client, context, id, input);
      default: throw new HttpError(404, "Unknown customer action.", "NOT_FOUND");
    }
  });
}
