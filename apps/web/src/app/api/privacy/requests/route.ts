import { z } from "zod";

import { createPrivacyRequest, listPrivacyRequests } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > Privacy and retention: the platform privacy request tracker
// (core/platform/privacy). platform.privacy.manage only - an elevated
// permission that ordinary module managers do not hold. Never billing-gated:
// a locked account must still be able to meet privacy obligations.
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.platformPrivacyManage, action: "privacy.requests.list" }, async ({ client, session }) =>
    ok({ rows: await listPrivacyRequests(client, session.organizationId) }),
  );
}

const schema = z.object({
  requestType: z.enum(["access", "export", "correction", "restriction", "erasure", "consent_withdrawal"]),
  subjectReference: z.string().trim().min(1).max(240),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.platformPrivacyManage, action: "privacy.requests.create", auditDenial: true },
    async ({ client, session }) => ok({ record: await createPrivacyRequest(client, session, schema.parse(await readJson(request))) }, 201),
  );
}
