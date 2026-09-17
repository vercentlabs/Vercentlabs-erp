import { z } from "zod";

import { assertSameOriginOrMobile, cancelPosCart } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = cancelSchema.parse(await readJson(request).catch(() => ({})));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create");
      return cancelPosCart(client, posContext(session), id, input);
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}
