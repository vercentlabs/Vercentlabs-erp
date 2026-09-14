import { z } from "zod";

import { requireApiPermission } from "@/core/authorization";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { createPrivacyRequest, listPrivacyRequests, listRetentionPolicies, writeRetentionPolicy } from "@/core/shared-platform";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), requestType: z.enum(["access", "export", "correction", "restriction", "erasure", "consent_withdrawal"]), subjectReference: z.string().trim().min(1).max(240), payload: z.record(z.string(), z.unknown()).optional() }),
  z.object({ action: z.literal("retention_policy"), dataClass: z.string().trim().min(1).max(120), retentionDays: z.number().int().min(1).max(36500), legalBasis: z.string().trim().min(1).max(500), effectiveFrom: z.string().datetime().optional(), effectiveTo: z.string().datetime().optional().nullable() }),
]);

export async function GET() {
  try {
    const session = await requireApiPermission("platform.privacy.manage");
    const [requests, retentionPolicies] = await Promise.all([
      listPrivacyRequests(session.organizationId),
      listRetentionPolicies(session.organizationId),
    ]);
    return ok({ requests, retentionPolicies });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("platform.privacy.manage");
    const input = actionSchema.parse(await readJson(request));
    const result = input.action === "request"
      ? await createPrivacyRequest(session, input)
      : await writeRetentionPolicy(session, input);
    await audit({ organizationId: session.organizationId, actorUserId: session.userId, eventType: `platform.privacy.${input.action}.created`, entityType: input.action, entityId: result.id, afterData: result, request });
    return ok({ ...result, message: "Privacy control recorded." }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
