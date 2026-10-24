import { listProcurementDepartments, saveProcurementDepartment } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Departments for purchase requests and their heads (?all=1 includes switched-off ones); POST { id?, name, headUserId?, active? } saves one.
export async function GET(request: Request) {
  const all = new URL(request.url).searchParams.get("all") === "1";
  return procurementRead(request, async (client, context) => ({ departments: await listProcurementDepartments(client, context, { includeInactive: all }) }));
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await saveProcurementDepartment(client, context, input) }), 200, "procurement.settings.manage");
}
