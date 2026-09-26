import { z } from "zod";

import { listPosOfflineSyncConflicts } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const querySchema = z.object({
  status: z.enum(["pending", "resolved_retried", "resolved_voided"]).optional(),
  storeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.offline.resolve" }, async ({ client, session }) => {
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse({
      status: searchParams.get("status") || undefined,
      storeId: searchParams.get("storeId") || undefined,
      limit: searchParams.get("limit") || undefined,
      offset: searchParams.get("offset") || undefined,
    });
    const result = await listPosOfflineSyncConflicts(client, posContext(session), input);
    return ok({ conflicts: result });
  });
}
