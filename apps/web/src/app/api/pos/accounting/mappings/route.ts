import { z } from "zod";

import { getPosAccountingMappingConfig, upsertPosAccountingMapping } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const upsertSchema = z.object({
  mappingKey: z.string().trim().min(1).max(100),
  accountId: z.string().uuid(),
});

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.settings.manage" }, async ({ client, session }) => {
    const result = await getPosAccountingMappingConfig(client, posContext(session));
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.settings.manage", billingWrite: true }, async ({ client, session }) => {
    const input = upsertSchema.parse(await readJson(request));
    const result = await upsertPosAccountingMapping(client, posContext(session), input);
    return ok({ mapping: result }, 201);
  });
}
