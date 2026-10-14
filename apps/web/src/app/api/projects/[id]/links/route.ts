import { getProjectLinks, linkProjectRecord } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };
// The records other modules own that relate to the project.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => getProjectLinks(client, context, id));
}
const schema = z.object({
  sourceType: z.enum(["CRM_ACCOUNT", "CRM_CONTACT", "CRM_OPPORTUNITY", "SALES_QUOTATION", "SALES_ORDER", "SALES_INVOICE", "PURCHASE_ORDER", "SUPPLIER_BILL"]),
  sourceId: z.string().uuid(), sourceLineId: z.string().uuid().optional(), linkType: z.enum(["ORIGIN", "DELIVERY", "BILLING", "RELATED"]).optional(), note: z.string().max(500).optional(),
  allowShared: z.boolean().optional(),
});
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => linkProjectRecord(client, context, id, input), 201);
}
