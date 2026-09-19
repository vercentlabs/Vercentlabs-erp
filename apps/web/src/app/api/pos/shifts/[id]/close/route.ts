import { z } from "zod";

import { assertSameOriginOrMobile, closeShift } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const closeShiftSchema = z.object({
  countedCash: z.number().min(0),
  closeNotes: z.string().trim().max(2_000).optional().nullable(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = closeShiftSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.shift.close", { mutation: true });
      return closeShift(client, posContext(session), id, input);
    });
    return ok({ shift: result });
  } catch (error) {
    return errorResponse(error);
  }
}
