import { z } from "zod";

import { requireApiPermission } from "@/core/authorization";
import { requireBillingWriteAccess } from "@/core/billing";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import {
  createDeveloperApiKey,
  listDeveloperApiKeys,
} from "@/core/shared-platform";

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).optional(),
  scopes: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function GET() {
  try {
    const session = await requireApiPermission("integrations.manage");
    const keys = await listDeveloperApiKeys(session.organizationId);
    return ok({
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.key_prefix,
        scopes: key.scopes,
        status: key.status,
        expiresAt: key.expires_at?.toISOString() || null,
        lastUsedAt: key.last_used_at?.toISOString() || null,
        createdAt: key.created_at.toISOString(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("integrations.manage");
    await requireBillingWriteAccess(session.organizationId);
    const input = createSchema.parse(await readJson(request));
    const created = await createDeveloperApiKey(session, input);
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "platform.api_key.created",
      entityType: "api_key",
      entityId: created.id,
      afterData: { prefix: created.prefix, scopes: created.scopes, expiresAt: created.expiresAt },
      request,
    });
    return ok({
      id: created.id,
      prefix: created.prefix,
      scopes: created.scopes,
      expiresAt: created.expiresAt?.toISOString() || null,
      token: created.token,
      message: "API key created. Copy the token now; it will not be shown again.",
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
