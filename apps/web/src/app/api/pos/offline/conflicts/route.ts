import { z } from "zod";

import { assertSameOriginOrMobile, listPosOfflineSyncConflicts } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const querySchema = z.object({
  status: z.enum(["pending", "resolved_retried", "resolved_voided"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { searchParams } = new URL(request.url);
    const input = querySchema.parse({
      status: searchParams.get("status") || undefined,
      limit: searchParams.get("limit") || undefined,
      offset: searchParams.get("offset") || undefined,
    });
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.offline.resolve");
      return listPosOfflineSyncConflicts(client, posContext(session), input);
    });
    return ok({ conflicts: result });
  } catch (error) {
    return errorResponse(error);
  }
}
