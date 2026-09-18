import { z } from "zod";

import { assertSameOriginOrMobile, recordPosDayEndVariance } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const varianceSchema = z.object({
  varianceType: z.enum(["cash_variance", "total_adjustment", "reclassification", "other"]),
  reason: z.string().trim().min(1).max(1_000),
  adjustment: z.array(z.record(z.string(), z.any())).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = varianceSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.report.finalize");
      return recordPosDayEndVariance(client, posContext(session), id, input);
    });
    return ok({ correction: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
