import { postPosSaleToAccounting } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.accounting.post" }, async ({ client, session }) => {
    const { id } = await context.params;
    const result = await postPosSaleToAccounting(client, posContext(session), id);
    return ok(result);
  });
}
