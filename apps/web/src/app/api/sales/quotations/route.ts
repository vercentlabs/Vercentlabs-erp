import { createQuotation, listQuotations } from "@vercentlabs/api";

import { quotationFiltersFromUrl } from "@/features/sales/quotations/server/quotation-http";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

// The quotation list: view, search, filters, sort and paging; scoped to the
// quotations the caller may see (own / team / all).
export async function GET(request: Request) {
  const filters = quotationFiltersFromUrl(new URL(request.url));
  return salesRead(request, "sales.quotation.view", async (client, context) => await listQuotations(client, context, filters));
}

// A new Draft (Sales → Quotations → New). From an opportunity, use the CRM route.
export async function POST(request: Request) {
  return salesMutation(
    request,
    "sales.quotation.create",
    documentSchema,
    async (client, context, input) => ({ quotation: await createQuotation(client, context, { ...input, source: "direct" }) }),
    201,
  );
}
