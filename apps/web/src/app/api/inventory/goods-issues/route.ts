import { createGoodsIssue, listGoodsIssues } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// Goods Issues. GET ?status=&warehouseId=&reasonId=&itemId=&issueToType=&projectId=&costCenterId=&from=&to=&search=&limit=&offset=; POST creates a draft (post: true posts it).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "warehouseId", "reasonId", "itemId", "issueToType", "projectId", "costCenterId", "from", "to", "search", "limit", "offset"]
    .map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => listGoodsIssues(client, context, filters), GOODS_ISSUE_PERMISSIONS.view);
}

export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await createGoodsIssue(client, context, input) }), 201,
    GOODS_ISSUE_PERMISSIONS.create);
}
