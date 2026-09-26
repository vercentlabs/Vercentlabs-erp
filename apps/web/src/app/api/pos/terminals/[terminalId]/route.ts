import { z } from "zod";

import { updatePosTerminal } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const updateTerminalSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  receiptPrefix: z.string().trim().min(1).max(20).optional(),
  storeId: z.string().uuid().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ terminalId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.terminal.manage", billingWrite: true }, async ({ client, session }) => {
    const { terminalId } = await context.params;
    const input = updateTerminalSchema.parse(await readJson(request));
    const result = await updatePosTerminal(client, posContext(session), terminalId, input);
    return ok({ terminal: result });
  });
}
