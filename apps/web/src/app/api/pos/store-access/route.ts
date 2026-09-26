import { z } from "zod";

import { grantPosStoreAccess, listPosStoreAccess, revokePosStoreAccess } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const accessSchema = z.object({ userId: z.string().uuid(), storeId: z.string().uuid(), terminalId: z.string().uuid().optional().nullable() });

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.store.manage" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const storeId = url.searchParams.get("storeId");
    const rows = await listPosStoreAccess(client, posContext(session), storeId);
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.store.manage", billingWrite: true }, async ({ client, session }) => {
    const input = accessSchema.parse(await readJson(request));
    const result = await grantPosStoreAccess(client, posContext(session), input);
    return ok({ grant: result }, 201);
  });
}

export async function DELETE(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.store.manage", billingWrite: true }, async ({ client, session }) => {
    const url = new URL(request.url);
    const input = accessSchema.parse({ userId: url.searchParams.get("userId"), storeId: url.searchParams.get("storeId"), terminalId: url.searchParams.get("terminalId") || undefined });
    const result = await revokePosStoreAccess(client, posContext(session), input);
    return ok(result);
  });
}
