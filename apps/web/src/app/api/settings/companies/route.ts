import { z } from "zod";

import { audit, createCompany, listOrganizationCompanies } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Companies visible/manageable by the caller: all of them for unrestricted
// administrators, only explicitly granted ones for delegated administrators
// (enforced in listOrganizationCompanies).
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.companyManage, action: "settings.companies.list" },
    async ({ client, session }) => ok({ companies: await listOrganizationCompanies(client, session) }),
  );
}

const postSchema = z.object({
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(30),
  countryCode: z.string().trim().length(2),
  baseCurrency: z.string().trim().length(3),
  taxId: z.string().trim().max(50).optional(),
  isPrimary: z.boolean().optional(),
});

// A new legal entity is organization-level: createCompany additionally
// requires organization.manage (or unrestricted administration).
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.companyManage, action: "settings.companies.create", auditDenial: true },
    async ({ client, session }) => {
      const body = postSchema.parse(await readJson(request));
      const company = await createCompany(client, session, body);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "company.created",
        entityType: "company",
        entityId: company.id,
        afterData: { name: company.name, code: company.code },
        request,
        env: process.env,
      });
      return ok({ company }, 201);
    },
  );
}
