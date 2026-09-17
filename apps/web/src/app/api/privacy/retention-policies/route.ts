import { assertSameOriginOrMobile, listRetentionPolicies, writeRetentionPolicy } from "@vercentlabs/api";

import { errorResponse, ok, readJson } from "@/core/http";
import { transaction, withClient } from "@/core/db";
import { requireWorkspace } from "@/core/session";
import { assertPrivacyManage } from "@/core/privacy-authorization";

export async function GET() {
  try {
    const session = await requireWorkspace();
    assertPrivacyManage(session);
    const rows = await withClient((client) => listRetentionPolicies(client, session.organizationId));
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

// writeRetentionPolicy is itself the versioning authority (privacy.js):
// each call creates a NEW version, closing out whatever version was
// previously open-ended for that data class — never an in-place edit of
// a historical policy version.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    assertPrivacyManage(session);
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await transaction((client) => writeRetentionPolicy(client, session, input));
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
