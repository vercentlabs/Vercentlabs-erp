import { z } from "zod";

import { assertSameOriginOrMobile, resolvePosReconciliation } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const resolveSchema = z.object({
  resolutionNotes: z.string().trim().min(1).max(2_000),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = resolveSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.reconciliation.approve");
      return resolvePosReconciliation(client, posContext(session), id, input);
    });
    return ok({ reconciliation: result });
  } catch (error) {
    return errorResponse(error);
  }
}
