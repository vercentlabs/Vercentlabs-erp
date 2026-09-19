import { z } from "zod";

import { assertSameOriginOrMobile, audit, createBranch, listOrganizationBranches } from "@vercentlabs/api";

import { transaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

export async function GET(request: Request) {
  try {
    const session = await requireApiWorkspace();
    const companyId = new URL(request.url).searchParams.get("companyId");
    const branches = await withClient((client) => listOrganizationBranches(client, session, companyId));
    return ok({ branches });
  } catch (error) {
    return errorResponse(error);
  }
}

const postSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(30),
  timezone: z.string().trim().min(1).max(100),
  companyId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const body = postSchema.parse(await readJson(request));
    const branch = await transaction(async (client) => {
      const created = await createBranch(client, session, body);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "branch.created",
        entityType: "branch",
        entityId: created.id,
        request,
        env: process.env,
      });
      return created;
    });
    return ok({ branch }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
