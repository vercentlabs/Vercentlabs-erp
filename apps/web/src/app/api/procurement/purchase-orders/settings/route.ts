import { getProcurementSettings, updateProcurementSettings } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Purchasing settings: how goods are billed, whether an expected date is required, the default receiving warehouse.
export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({ settings: await getProcurementSettings(client, context) }), "procurement.po.view");
}

export async function PATCH(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ settings: await updateProcurementSettings(client, context, input) }), 200, "procurement.settings.manage");
}
