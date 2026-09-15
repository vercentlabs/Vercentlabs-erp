import { z } from "zod";

import { requireApiPermission } from "@/core/authorization";
import { requireBillingWriteAccess } from "@/core/billing";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import {
  assignEntityTag,
  createTagDefinition,
  listEntityTags,
  listTagDefinitions,
  removeEntityTag,
} from "@/core/shared-platform";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("definition"), entityType: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(120), color: z.string().trim().regex(/^#[0-9a-f]{6}$/i).optional().nullable() }),
  z.object({ action: z.literal("assign"), tagId: z.string().uuid(), entityType: z.string().trim().min(1).max(120), entityId: z.string().trim().min(1).max(240) }),
  z.object({ action: z.literal("remove"), tagId: z.string().uuid(), entityType: z.string().trim().min(1).max(120), entityId: z.string().trim().min(1).max(240) }),
]);

export async function GET(request: Request) {
  try {
    const session = await requireApiPermission("platform.extensibility.manage");
    const url = new URL(request.url);
    const entityType = url.searchParams.get("entityType") || undefined;
    const entityId = url.searchParams.get("entityId") || undefined;
    const definitions = await listTagDefinitions(session.organizationId, entityType);
    const assigned = entityType && entityId
      ? await listEntityTags(session.organizationId, entityType, entityId)
      : [];
    return ok({ definitions, assigned });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("platform.extensibility.manage");
    await requireBillingWriteAccess(session.organizationId);
    const input = actionSchema.parse(await readJson(request));
    const result = input.action === "definition"
      ? await createTagDefinition(session, input)
      : input.action === "assign"
        ? await assignEntityTag(session, input)
        : (await removeEntityTag(session, input), { tagId: input.tagId, removed: true });
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: `platform.tag.${input.action}`,
      entityType: "shared_tag",
      entityId: "tagId" in result ? String(result.tagId) : result.id,
      afterData: result,
      request,
    });
    return ok({ ...result, message: "Tag control updated." }, input.action === "definition" ? 201 : 200);
  } catch (error) {
    return errorResponse(error);
  }
}
