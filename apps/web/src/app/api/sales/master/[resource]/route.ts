import { z } from "zod";

import { createBusinessDataRecord, listBusinessDataRecords } from "@vercentlabs/api";

import { assertReadable, assertWritable, CUSTOMER_TYPES, shapeCustomerInput } from "@/features/sales/master/server/master-resources";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  const url = new URL(request.url);
  return salesRead("sales.view", async (client, context) => {
    assertReadable(resource);
    const status = url.searchParams.get("status");
    const result = await listBusinessDataRecords(client, context, resource, {
      search: url.searchParams.get("search") || undefined,
      status: status === "active" || status === "inactive" || status === "all" ? status : undefined,
      limit: Number(url.searchParams.get("limit") ?? 200),
      offset: Number(url.searchParams.get("offset") ?? 0),
    });
    // Suppliers live in the same table; Sales never lists them.
    if (resource === "parties") return { ...result, rows: result.rows.filter((row: { partyType?: string }) => CUSTOMER_TYPES.includes(String(row.partyType))) };
    // Item rows carry cost (standard cost, purchase price). Cost is margin
    // information: without sales.margin.view it is removed here, server-side.
    const canSeeCost = context.roleSlugs.includes("organization_owner") || context.permissions.includes("sales.margin.view");
    if (resource === "items" && !canSeeCost) {
      return { ...result, rows: result.rows.map((row: Record<string, unknown>) => { const safe = { ...row }; delete safe.standardCost; delete safe.purchasePrice; return safe; }) };
    }
    return result;
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  return salesMutation(
    request,
    "parties.manage",
    z.record(z.string(), z.unknown()),
    async (client, context, input) => {
      assertWritable(resource);
      return { record: await createBusinessDataRecord(client, context, resource, shapeCustomerInput(resource, input, true)) };
    },
    201,
  );
}
