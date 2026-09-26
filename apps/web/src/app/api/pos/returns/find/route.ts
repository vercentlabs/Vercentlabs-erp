import { findPosSaleForReturn } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.return.create" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const receiptNumber = url.searchParams.get("receiptNumber") || "";
    const result = await findPosSaleForReturn(client, posContext(session), { receiptNumber });
    return ok(result);
  });
}
