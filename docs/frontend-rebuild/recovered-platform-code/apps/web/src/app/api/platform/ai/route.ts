import { z } from "zod";

import { requireApiPermission } from "@/core/authorization";
import { requireBillingWriteAccess } from "@/core/billing";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { listAiPolicies, recordAiEvaluation, recordAiRequest, setAiPolicy } from "@/core/shared-platform";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("policy"), policyKey: z.string().trim().min(1).max(160), enabled: z.boolean(), allowRead: z.boolean(), allowPropose: z.boolean(), allowExecute: z.boolean(), requiresApproval: z.boolean(), allowedTools: z.array(z.string()).max(32).optional(), dataClasses: z.array(z.string()).max(32).optional() }),
  z.object({ action: z.literal("request"), policyKey: z.string().trim().min(1).max(160), requestType: z.enum(["read", "propose", "execute"]), prompt: z.string().min(1).max(20_000), contextManifest: z.record(z.string(), z.unknown()).optional(), provenance: z.array(z.unknown()).max(100).optional(), modelIdentifier: z.string().trim().max(240).optional(), actionKey: z.string().trim().max(160).optional() }),
  z.object({ action: z.literal("evaluation"), aiRequestId: z.string().uuid(), evaluationKey: z.string().trim().min(1).max(160), score: z.number(), threshold: z.number().optional().nullable(), evidence: z.record(z.string(), z.unknown()).optional() }),
]);

export async function GET() {
  try {
    const session = await requireApiPermission("platform.ai.manage");
    return ok({ policies: await listAiPolicies(session.organizationId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("platform.ai.manage");
    await requireBillingWriteAccess(session.organizationId);
    const input = actionSchema.parse(await readJson(request));
    const result = input.action === "policy"
      ? await setAiPolicy(session, input)
      : input.action === "request"
        ? await recordAiRequest(session, input)
        : await recordAiEvaluation(session, input);
    await audit({ organizationId: session.organizationId, actorUserId: session.userId, eventType: `platform.ai.${input.action}.recorded`, entityType: `ai_${input.action}`, entityId: result.id, request });
    return ok({ ...result, message: "AI governance evidence recorded." }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
