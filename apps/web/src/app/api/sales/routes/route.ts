import { listSalesRoutes, saveSalesRoute } from "@vercentlabs/api";

import { beatSchema } from "@/features/sales/settings/server/beat-schema";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Beats (Sales plan, Phase 4): ?status=active|inactive|all&today=true.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return salesRead(request, "sales.view", async (client, context) =>
    listSalesRoutes(client, context, { status: url.searchParams.get("status") ?? undefined, today: url.searchParams.get("today") === "true" }));
}

export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", beatSchema, async (client, context, input) => saveSalesRoute(client, context, input), 201);
}
