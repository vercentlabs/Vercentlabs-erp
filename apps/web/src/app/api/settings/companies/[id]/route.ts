import { z } from "zod";

import { audit, updateCompany } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const putSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  legalName: z.string().trim().min(1).max(200).optional(),
  taxId: z.string().trim().max(50).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

// Delegated administrators may update only companies they are granted;
// anything else answers "not found" (updateCompany).
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.companyManage, action: "settings.companies.update", transaction: "platform", auditDenial: true },
    async ({ client, session }) => {
      const { id } = await context.params;
      const body = putSchema.parse(await readJson(request));
      const company = await updateCompany(client, session, id, body);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "company.updated",
        entityType: "company",
        entityId: id,
        afterData: body,
        request,
        env: process.env,
      });
      return ok({ company });
    },
  );
}
