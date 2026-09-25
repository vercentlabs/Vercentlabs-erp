import { assertSameOriginOrMobile, executePrivacyRequest } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Executes a data-subject request: access/export produce an export
// payload, correction applies input.corrections, deletion applies
// input.erasureMode ("anonymize" | "erase"), and restriction/consent-
// withdrawal restrict the subject. All governed inside
// executePrivacyRequest (previewPrivacyRequest's own readiness check runs
// again inside it) and recorded to the immutable
// crm_privacy_execution_runs audit trail — this route only authenticates
// and forwards input.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.privacyManage, { mutation: true });
      return executePrivacyRequest(client, crmContext(session), id, input);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
