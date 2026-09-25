import { z } from "zod";

import { audit, createBranch, listOrganizationBranches } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const companyFilter = z.string().uuid().nullable();

export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.branchManage, action: "settings.branches.list", transaction: "none" },
    async ({ client, session }) => {
      const companyId = companyFilter.parse(new URL(request.url).searchParams.get("companyId"));
      return ok({ branches: await listOrganizationBranches(client, session, companyId) });
    },
  );
}

const postSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(30),
  timezone: z.string().trim().min(1).max(100),
  companyId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
});

// Delegated administrators may only open branches under a company they
// administer; the new branch is granted to them in the same transaction.
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.branchManage, action: "settings.branches.create", transaction: "platform", auditDenial: true },
    async ({ client, session }) => {
      const body = postSchema.parse(await readJson(request));
      const branch = await createBranch(client, session, body);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "branch.created",
        entityType: "branch",
        entityId: branch.id,
        afterData: { name: branch.name, code: branch.code, companyId: branch.company_id },
        request,
        env: process.env,
      });
      return ok({ branch }, 201);
    },
  );
}
