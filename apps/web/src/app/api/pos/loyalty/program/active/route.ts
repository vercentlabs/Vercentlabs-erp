import { z } from "zod";

import { assertSameOriginOrMobile, setPosLoyaltyProgramActive } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const activeSchema = z.object({ active: z.boolean() });

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = activeSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.loyalty.manage", { mutation: true });
      return setPosLoyaltyProgramActive(client, posContext(session), input.active);
    });
    return ok({ record: result });
  } catch (error) {
    return errorResponse(error);
  }
}
