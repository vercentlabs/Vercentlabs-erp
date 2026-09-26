import { z } from "zod";

import { getPosStorePaymentConfig, setPosStorePaymentConfig } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const providerSchema = z.object({
  providerKey: z.string().trim().min(1).max(60).optional(),
  // The NAME of an environment variable a real credential would live in --
  // never a credential value; the domain function rejects anything else.
  credentialEnvVar: z.string().trim().max(64).nullable().optional(),
});

const configSchema = z.object({
  allowedMethods: z.array(z.string().trim().min(1).max(30)).max(10),
  providers: z.record(z.string(), providerSchema).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.store.manage" }, async ({ client, session }) => {
    const { storeId } = await context.params;
    const result = await getPosStorePaymentConfig(client, posContext(session), storeId);
    return ok({ config: result });
  });
}

export async function PUT(request: Request, context: { params: Promise<{ storeId: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.store.manage", billingWrite: true }, async ({ client, session }) => {
    const { storeId } = await context.params;
    const input = configSchema.parse(await readJson(request));
    const result = await setPosStorePaymentConfig(client, posContext(session), storeId, input);
    return ok({ config: result });
  });
}
