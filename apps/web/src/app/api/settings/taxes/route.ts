import { getTaxOptions, listTaxCategories, listTaxRegistrations } from "@vercentlabs/api";

import { taxRead } from "@/features/settings/taxes/server/tax-http";

// Settings → Taxes: the choices, the tax categories (filtered) and the company registrations.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["search", "status", "treatment", "taxType", "rate", "asOf"].flatMap((key) => {
    const value = url.searchParams.get(key);
    return value ? [[key, value]] : [];
  }));
  return taxRead(request, "tax.view", async (client, context) => ({
    options: await getTaxOptions(client, context),
    categories: await listTaxCategories(client, context, filters),
    registrations: await listTaxRegistrations(client, context),
  }));
}
