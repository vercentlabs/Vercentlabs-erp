import { getReceivingWarehouseUsers, setReceivingWarehouseUsers } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Who may receive into each warehouse (nobody listed: anyone allowed to receive).
export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({ warehouses: await getReceivingWarehouseUsers(client, context) }), "procurement.po.view");
}

export async function PUT(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await setReceivingWarehouseUsers(client, context, input) }), 200, "procurement.receipts.access");
}
