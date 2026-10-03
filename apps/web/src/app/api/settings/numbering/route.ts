import { z } from "zod";

import { getNumberingOverview, setNumberingPolicy } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > Numbering. Policies and counters are tenant data (FORCE RLS), so
// this runs in a tenant transaction. Never billing-gated: numbering is account
// administration.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.numberingManage, action: "numbering.view" },
    async ({ client, session }) =>
      ok({
        overview: await getNumberingOverview(client, session.organizationId),
      }),
  );
}

const policySchema = z.object({
  documentType: z.string().trim().min(1).max(160),
  prefix: z.string().trim().min(1).max(24),
  padding: z.number().int().min(1).max(12),
  resetPolicy: z.enum(["never", "calendar_year", "fiscal_year"]),
  expectedVersion: z.number().int().min(0).nullable().optional(),
});

export async function PUT(request: Request) {
  return workspaceRoute(
    request,
    {
      permission: CORE_PERMISSIONS.numberingManage,
      action: "numbering.policy_update",
      auditDenial: true,
    },
    async ({ client, session }) =>
      ok({
        policy: await setNumberingPolicy(
          client,
          session,
          policySchema.parse(await readJson(request)),
        ),
      }),
  );
}
