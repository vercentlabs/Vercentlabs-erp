import { z } from "zod";

import { assertSameOriginOrMobile, setPosCouponActive } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const activeSchema = z.object({ active: z.boolean() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = activeSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.settings.manage", { mutation: true });
      return setPosCouponActive(client, posContext(session), id, input.active);
    });
    return ok({ record: result });
  } catch (error) {
    return errorResponse(error);
  }
}
