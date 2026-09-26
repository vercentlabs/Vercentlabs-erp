import { createQuotation, listQuotations } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = {
    status: url.searchParams.get("status") || undefined,
    search: url.searchParams.get("search") || undefined,
    partyId: url.searchParams.get("partyId") || undefined,
    opportunityId: url.searchParams.get("opportunityId") || undefined,
    limit: url.searchParams.get("limit") || undefined,
    offset: url.searchParams.get("offset") || undefined,
  };
  return salesRead(request, "sales.view", async (client, context) => ({ rows: await listQuotations(client, context, filters) }));
}

export async function POST(request: Request) {
  return salesMutation(request, "sales.quotation.create", documentSchema, async (client, context, input) => ({ quotation: await createQuotation(client, context, input) }), 201);
}
