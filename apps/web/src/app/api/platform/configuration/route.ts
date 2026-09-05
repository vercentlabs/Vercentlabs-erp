import { z } from "zod";

import { requireApiPermission } from "@/core/authorization";
import { requireBillingWriteAccess } from "@/core/billing";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import {
  listConfigurationVersions,
  listFeatureFlags,
  setFeatureFlag,
  writeConfigurationVersion,
} from "@/core/shared-platform";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configuration"), namespace: z.string().trim().min(1).max(120), key: z.string().trim().min(1).max(160), value: z.unknown(), effectiveFrom: z.string().datetime().optional() }),
  z.object({ action: z.literal("feature_flag"), key: z.string().trim().min(1).max(160), enabled: z.boolean(), rules: z.record(z.string(), z.unknown()).optional(), effectiveFrom: z.string().datetime().optional(), effectiveTo: z.string().datetime().optional().nullable() }),
]);

export async function GET(request: Request) {
  try {
    const session = await requireApiPermission("platform.configuration.manage");
    const namespace = new URL(request.url).searchParams.get("namespace") || undefined;
    const [versions, featureFlags] = await Promise.all([
      listConfigurationVersions(session.organizationId, namespace),
      listFeatureFlags(session.organizationId),
    ]);
    return ok({ versions, featureFlags });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("platform.configuration.manage");
    await requireBillingWriteAccess(session.organizationId);
    const input = actionSchema.parse(await readJson(request));
    const result = input.action === "configuration"
      ? await writeConfigurationVersion(session, input)
      : await setFeatureFlag(session, input);
    await audit({ organizationId: session.organizationId, actorUserId: session.userId, eventType: `platform.${input.action}.changed`, entityType: input.action, entityId: result.id, afterData: { version: result.version }, request });
    return ok({ ...result, message: "Platform configuration updated." }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
