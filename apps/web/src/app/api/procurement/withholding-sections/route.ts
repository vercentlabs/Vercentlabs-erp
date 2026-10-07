import { listWithholdingSections, saveWithholdingSection } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// TDS / withholding sections of the shared tax set-up (code, name, rate), used on supplier bills.
export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({ sections: await listWithholdingSections(client, context, { includeInactive: true }) }), "procurement.bills.view");
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ section: await saveWithholdingSection(client, context, (input as { id?: string }).id ?? null, input) }), 200,
    "tax.rates.manage");
}
