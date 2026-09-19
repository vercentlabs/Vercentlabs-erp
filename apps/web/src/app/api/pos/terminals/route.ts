import { z } from "zod";

import { assertSameOriginOrMobile, createTerminal, listPointOfSaleResource } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const createTerminalSchema = z.object({
  storeId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  receiptPrefix: z.string().trim().min(1).max(20).optional(),
});

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listPointOfSaleResource(client, posContext(session), "terminals", {
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
      });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = createTerminalSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.terminal.manage", { mutation: true });
      return createTerminal(client, posContext(session), input);
    });
    return ok({ terminal: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
