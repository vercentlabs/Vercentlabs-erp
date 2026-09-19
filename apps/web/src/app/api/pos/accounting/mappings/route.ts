import { z } from "zod";

import { assertSameOriginOrMobile, getPosAccountingMappingConfig, upsertPosAccountingMapping } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const upsertSchema = z.object({
  mappingKey: z.string().trim().min(1).max(100),
  accountId: z.string().uuid(),
});

export async function GET() {
  try {
    const session = await requireWorkspace();
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.settings.manage");
      return getPosAccountingMappingConfig(client, posContext(session));
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = upsertSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.settings.manage", { mutation: true });
      return upsertPosAccountingMapping(client, posContext(session), input);
    });
    return ok({ mapping: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
