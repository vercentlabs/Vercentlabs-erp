import { z } from "zod";

import { assertSameOriginOrMobile, setPosTerminalStatus } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const setStatusSchema = z.object({ status: z.enum(["active", "inactive", "maintenance"]) });

export async function POST(request: Request, context: { params: Promise<{ terminalId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { terminalId } = await context.params;
    const { status } = setStatusSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.terminal.manage", { mutation: true });
      return setPosTerminalStatus(client, posContext(session), terminalId, status);
    });
    return ok({ terminal: result });
  } catch (error) {
    return errorResponse(error);
  }
}
