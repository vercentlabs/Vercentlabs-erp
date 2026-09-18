import { z } from "zod";

import { assertSameOriginOrMobile, reviewPosDayEndReport } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const reviewSchema = z.object({
  reviewNotes: z.string().trim().max(2_000).optional().nullable(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = reviewSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.report.generate");
      return reviewPosDayEndReport(client, posContext(session), id, input);
    });
    return ok({ report: result });
  } catch (error) {
    return errorResponse(error);
  }
}
