import { z } from "zod";

import { assertSameOriginOrMobile, audit, setUserBranchAccess, setUserCompanyAccess } from "@vercentlabs/api";

import { transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

const putSchema = z.object({
  companyIds: z.array(z.string().uuid()).max(200),
  branchIds: z.array(z.string().uuid()).max(200),
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const { id } = await context.params;
    const body = putSchema.parse(await readJson(request));
    const result = await transaction(async (client) => {
      const companies = await setUserCompanyAccess(client, session, id, body.companyIds);
      const branches = await setUserBranchAccess(client, session, id, body.branchIds);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "user.access_updated",
        entityType: "organization_membership",
        entityId: id,
        request,
        env: process.env,
      });
      return { ...companies, ...branches };
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
