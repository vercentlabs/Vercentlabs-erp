import { z } from "zod";

import { assertSameOriginOrMobile, updatePosTerminal } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const updateTerminalSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  receiptPrefix: z.string().trim().min(1).max(20).optional(),
  storeId: z.string().uuid().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ terminalId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { terminalId } = await context.params;
    const input = updateTerminalSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.terminal.manage", { mutation: true });
      return updatePosTerminal(client, posContext(session), terminalId, input);
    });
    return ok({ terminal: result });
  } catch (error) {
    return errorResponse(error);
  }
}
