import { z } from "zod";

import { setPosStoreActive } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const setActiveSchema = z.object({ active: z.boolean() });

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.store.manage", billingWrite: true }, async ({ client, session }) => {
    const { storeId } = await context.params;
    const { active } = setActiveSchema.parse(await readJson(request));
    const result = await setPosStoreActive(client, posContext(session), storeId, active);
    return ok({ store: result });
  });
}
