import { assertSameOriginOrMobile, createPrivacyRequest, listPrivacyRequests } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { transaction, withClient } from "@/core/db";
import { requireWorkspace } from "@/core/session";

// F002 Stage A2 §13. Wires the shared PLATFORM privacy authority
// (services/api/src/core/privacy.js — a real, already-built, org-scoped
// finite-state-machine request tracker with zero frontend consumer
// anywhere in the app, not just CRM) rather than building CRM-local
// privacy logic. Deliberately NOT under /api/crm/ and NOT gated by
// crm.* permissions — this is a platform capability CRM's UI merely
// surfaces, gated by platform.privacy.manage, a genuinely elevated
// permission excluded from the default "privileged" role bundle (see
// packages/permissions/src/roles.js) so an ordinary CRM manager with
// crm.accounts.manage does not also gain privacy-administration
// authority just by being able to view an Account.
function assertPrivacyManage(session: { permissions?: string[] }) {
  if (!session.permissions?.includes(CORE_PERMISSIONS.platformPrivacyManage))
    throw new HttpError(403, "You do not have permission to manage privacy requests.");
}

export async function GET() {
  try {
    const session = await requireWorkspace();
    assertPrivacyManage(session);
    const rows = await withClient((client) => listPrivacyRequests(client, session.organizationId));
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    assertPrivacyManage(session);
    const input = (await readJson(request)) as { requestType?: string; subjectReference?: string; payload?: Record<string, unknown> };
    const record = await transaction((client) => createPrivacyRequest(client, session, input));
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
