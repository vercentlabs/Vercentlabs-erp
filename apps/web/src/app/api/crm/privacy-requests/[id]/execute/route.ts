import { executePrivacyRequest } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Executes a data-subject request: access/export produce an export
// payload, correction applies input.corrections, deletion applies
// input.erasureMode ("anonymize" | "erase"), and restriction/consent-
// withdrawal restrict the subject. All governed inside
// executePrivacyRequest (previewPrivacyRequest's own readiness check runs
// again inside it) and recorded to the immutable
// crm_privacy_execution_runs audit trail — this route only authenticates
// and forwards input.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.privacyManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    const result = await executePrivacyRequest(client, crmContext(session), id, input);
    return ok(result);
  });
}
