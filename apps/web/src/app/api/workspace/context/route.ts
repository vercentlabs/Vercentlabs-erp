import { z } from "zod";

import { switchActiveCompany } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const switchSchema = z.object({
  companyId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
});

// Switch the active company/branch (validated against the caller's own access
// by switchActiveCompany).
export async function PATCH(request: Request) {
  return workspaceRoute(request, { action: "workspace.context.switch" }, async ({ client, session }) => {
    const body = switchSchema.parse(await readJson(request));
    return ok(await switchActiveCompany(client, session, body.companyId, body.branchId ?? null));
  });
}
