import { z } from "zod";

import { setPosTerminalStatus } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const setStatusSchema = z.object({ status: z.enum(["active", "inactive", "maintenance"]) });

export async function POST(request: Request, context: { params: Promise<{ terminalId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.terminal.manage", billingWrite: true }, async ({ client, session }) => {
    const { terminalId } = await context.params;
    const { status } = setStatusSchema.parse(await readJson(request));
    const result = await setPosTerminalStatus(client, posContext(session), terminalId, status);
    return ok({ terminal: result });
  });
}
