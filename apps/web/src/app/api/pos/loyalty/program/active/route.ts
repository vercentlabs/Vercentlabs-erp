import { z } from "zod";

import { setPosLoyaltyProgramActive } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const activeSchema = z.object({ active: z.boolean() });

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.loyalty.manage", billingWrite: true }, async ({ client, session }) => {
    const input = activeSchema.parse(await readJson(request));
    const result = await setPosLoyaltyProgramActive(client, posContext(session), input.active);
    return ok({ record: result });
  });
}
