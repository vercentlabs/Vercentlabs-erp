import { z } from "zod";

import { getNumberingOverview, listAccessibleCompanies, setNumberingPolicy } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > Numbering. Policies and counters are tenant data (FORCE RLS), so
// this runs in a tenant transaction. Never billing-gated: numbering is account
// administration.
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.numberingManage, action: "numbering.view" }, async ({ client, session }) => {
    const companies = (await listAccessibleCompanies(client, session.organizationId, session.userId)).map(({ id, name }) => ({ id, name }));
    const requested = new URL(request.url).searchParams.get("companyId");
    const companyId = companies.some((company) => company.id === requested) ? requested : companies[0]?.id;
    if (!companyId) return ok({ companies, overview: null });
    return ok({ companies, overview: await getNumberingOverview(client, session.organizationId, companyId) });
  });
}

const policySchema = z.object({
  documentType: z.string().trim().min(1).max(160),
  companyId: z.string().uuid().nullable().optional(),
  prefix: z.string().trim().min(1).max(24),
  padding: z.number().int().min(1).max(12),
  resetPolicy: z.enum(["never", "calendar_year", "fiscal_year"]),
  expectedVersion: z.number().int().min(0).nullable().optional(),
});

export async function PUT(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.numberingManage, action: "numbering.policy_update", auditDenial: true },
    async ({ client, session }) => ok({ policy: await setNumberingPolicy(client, session, policySchema.parse(await readJson(request))) }),
  );
}
