import { listPosStoreSetupOptions } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.store.manage" }, async ({ client, session }) => {
    const result = await listPosStoreSetupOptions(client, posContext(session));
    return ok(result);
  });
}
