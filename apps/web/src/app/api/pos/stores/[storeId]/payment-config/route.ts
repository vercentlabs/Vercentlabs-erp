import { z } from "zod";

import { assertSameOriginOrMobile, getPosStorePaymentConfig, setPosStorePaymentConfig } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

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

export async function GET(_request: Request, context: { params: Promise<{ storeId: string }> }) {
  try {
    const session = await requireWorkspace();
    const { storeId } = await context.params;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.store.manage");
      return getPosStorePaymentConfig(client, posContext(session), storeId);
    });
    return ok({ config: result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ storeId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { storeId } = await context.params;
    const input = configSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.store.manage", { mutation: true });
      return setPosStorePaymentConfig(client, posContext(session), storeId, input);
    });
    return ok({ config: result });
  } catch (error) {
    return errorResponse(error);
  }
}
