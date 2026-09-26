import { z } from "zod";

import { setPosCouponActive } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const activeSchema = z.object({ active: z.boolean() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.settings.manage", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = activeSchema.parse(await readJson(request));
    const result = await setPosCouponActive(client, posContext(session), id, input.active);
    return ok({ record: result });
  });
}
