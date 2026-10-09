import { createGoodsIssueReason, listGoodsIssueReasons } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

export async function GET(request: Request) {
  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
  return inventoryRead(request, async (client, context) => ({ reasons: await listGoodsIssueReasons(client, context, { includeInactive }) }), GOODS_ISSUE_PERMISSIONS.view);
}

export async function POST(request: Request) {
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ reason: await createGoodsIssueReason(client, context, input) }), 201,
    GOODS_ISSUE_PERMISSIONS.manageReasons);
}
