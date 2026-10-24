import { createJobWork, listJobWork } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Job work (report Phase 3): ?view=open | overdue | all; POST a new job-work challan (draft).
export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get("view") ?? "open";
  return workspaceRoute(request, { module: "procurement", permission: "procurement.view" }, async ({ client, session }) =>
    Response.json(await listJobWork(client, procurementContext(session), { view })));
}

export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createJobWork(client, context, input) }), 201, "procurement.view");
}
