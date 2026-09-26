import { z } from "zod";

import { listPrivacyDataClasses, listRetentionPolicies, writeRetentionPolicy } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Versioned retention policies for REGISTERED data classes. Each policy says
// how it is enforced - most are recorded for review; statutory records are
// never deleted automatically.
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.platformPrivacyManage, action: "privacy.retention.list", transaction: "none" }, async ({ client, session }) =>
    ok({ rows: await listRetentionPolicies(client, session.organizationId), dataClasses: listPrivacyDataClasses() }),
  );
}

const schema = z.object({
  dataClass: z.string().trim().min(1).max(120),
  retentionDays: z.number().int().min(1).max(36500),
  legalBasis: z.string().trim().min(1).max(500),
  effectiveFrom: z.string().datetime({ offset: true }).nullable().optional(),
});

// writeRetentionPolicy creates a NEW version and closes the previous one; a
// historical version is never edited in place.
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.platformPrivacyManage, action: "privacy.retention.write", transaction: "platform", auditDenial: true },
    async ({ client, session }) => ok({ record: await writeRetentionPolicy(client, session, schema.parse(await readJson(request))) }, 201),
  );
}
