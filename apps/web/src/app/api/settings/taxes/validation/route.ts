import { validateTaxConfiguration } from "@vercentlabs/api";

import { taxRead } from "@/features/settings/taxes/server/tax-http";

// What in the tax set-up would stop a sale or make its tax wrong (gaps, overlaps, missing classifications, registrations). Read-only.
export async function GET(request: Request) {
  return taxRead(request, "tax.view", async (client, context) => ({ validation: await validateTaxConfiguration(client, context) }));
}
