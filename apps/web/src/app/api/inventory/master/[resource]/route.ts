import { z } from "zod";

import {
  createBusinessDataRecord,
  listBusinessDataRecords,
  requireSessionPermission,
} from "@vercentlabs/api";

import {
  INVENTORY_MASTER,
  masterResource,
  shapeMasterCreate,
} from "@/features/inventory/server/master";
import {
  inventoryMutation,
  inventoryRead,
} from "@/features/inventory/shared/route-helpers";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ resource: string }> },
) {
  const { resource } = await ctx.params;
  const url = new URL(request.url);
  return inventoryRead(request, async (client, context) => {
    const name = masterResource(resource);
    const status = url.searchParams.get("status");
    const result = await listBusinessDataRecords(client, context, name, {
      search: url.searchParams.get("search") || undefined,
      status:
        status === "active" || status === "inactive" || status === "all"
          ? status
          : undefined,
      limit: Number(url.searchParams.get("limit") ?? 500),
      offset: Number(url.searchParams.get("offset") ?? 0),
    });
    return result;
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ resource: string }> },
) {
  const { resource } = await ctx.params;
  return inventoryMutation(
    request,
    z.record(z.string(), z.unknown()),
    async (client, context, input, session) => {
      const name = masterResource(resource);
      requireSessionPermission(session, INVENTORY_MASTER[name].permission);
      return {
        record: await createBusinessDataRecord(
          client,
          context,
          name,
          shapeMasterCreate(name, input),
        ),
      };
    },
    201,
  );
}
