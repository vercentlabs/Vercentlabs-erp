import { z } from "zod";

import { createTerminal, listPointOfSaleResource } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const createTerminalSchema = z.object({
  storeId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  receiptPrefix: z.string().trim().min(1).max(20).optional(),
});

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const rows = await listPointOfSaleResource(client, posContext(session), "terminals", {
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    });
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.terminal.manage", billingWrite: true }, async ({ client, session }) => {
    const input = createTerminalSchema.parse(await readJson(request));
    const result = await createTerminal(client, posContext(session), input);
    return ok({ terminal: result }, 201);
  });
}
