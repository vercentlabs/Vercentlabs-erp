import { z } from "zod";

import { createBusinessDataRecord, listBusinessDataRecords, requireSessionPermission } from "@vercentlabs/api";

import { INVENTORY_MASTER, masterResource, shapeMasterCreate } from "@/features/inventory/server/master";
import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  const url = new URL(request.url);
  return inventoryRead(request, async (client, context) => {
    const name = masterResource(resource);
    const status = url.searchParams.get("status");
    const result = await listBusinessDataRecords(client, context, name, {
      search: url.searchParams.get("search") || undefined,
      status: status === "active" || status === "inactive" || status === "all" ? status : undefined,
      limit: Number(url.searchParams.get("limit") ?? 500),
      offset: Number(url.searchParams.get("offset") ?? 0),
    });
    // Item and variant rows carry cost. Cost is valuation information: without
    // stock.valuation.view it is removed here, server-side.
    const canSeeCost = context.roleSlugs.includes("organization_owner") || context.roleSlugs.includes("system_administrator") || context.permissions.includes("stock.valuation.view");
    if ((name === "items" || name === "item-variants") && !canSeeCost) {
      return { ...result, rows: result.rows.map((row: Record<string, unknown>) => { const safe = { ...row }; delete safe.standardCost; delete safe.purchasePrice; return safe; }) };
    }
    return result;
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  return inventoryMutation(
    request,
    z.record(z.string(), z.unknown()),
    async (client, context, input, session) => {
      const name = masterResource(resource);
      requireSessionPermission(session, INVENTORY_MASTER[name].permission);
      return { record: await createBusinessDataRecord(client, context, name, shapeMasterCreate(name, input, context.activeCompanyId)) };
    },
    201,
  );
}
