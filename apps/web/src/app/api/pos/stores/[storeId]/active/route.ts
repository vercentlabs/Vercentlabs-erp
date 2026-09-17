import { z } from "zod";

import { assertSameOriginOrMobile, setPosStoreActive } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const setActiveSchema = z.object({ active: z.boolean() });

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { storeId } = await context.params;
    const { active } = setActiveSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.store.manage");
      return setPosStoreActive(client, posContext(session), storeId, active);
    });
    return ok({ store: result });
  } catch (error) {
    return errorResponse(error);
  }
}
