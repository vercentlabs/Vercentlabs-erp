import { z } from "zod";

import { assertSameOriginOrMobile, generatePosReconciliation } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const generateSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = generateSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.reconciliation.manage");
      return generatePosReconciliation(client, posContext(session), id, input);
    });
    return ok(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
