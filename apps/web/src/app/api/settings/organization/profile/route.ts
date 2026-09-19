import { z } from "zod";

import { assertSameOriginOrMobile, audit, getOrganizationProfile, updateOrganizationProfile } from "@vercentlabs/api";

import { transaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

export async function GET() {
  try {
    const session = await requireApiWorkspace();
    const profile = await withClient((client) => getOrganizationProfile(client, session.organizationId));
    return ok({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}

const putSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
});

export async function PUT(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const body = putSchema.parse(await readJson(request));
    const profile = await transaction(async (client) => {
      const updated = await updateOrganizationProfile(client, session, body);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "organization.profile.updated",
        entityType: "organization",
        entityId: session.organizationId,
        request,
        env: process.env,
      });
      return updated;
    });
    return ok({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}
