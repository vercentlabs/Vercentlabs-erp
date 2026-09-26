import { addContactAccountRelationship, listContactAccountRelationships } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F003 Stage A2 — listContactAccountRelationships/addContactAccountRelationship
// (contact-relationships.js) already governed a full multi-account Contact
// relationship model (tenant.crm_contact_account_relationships, migration
// 088) — organization scope, relationship/stakeholder role, primary
// semantics, audit, merge reconciliation — already tested
// (crm-contact-account-relationships-f003.test.mjs) with zero frontend
// consumer before this pass. Not a new migration; a wiring gap.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listContactAccountRelationships(client, crmContext(session), id);
    return ok({ rows });
  });
}

export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const rows = await addContactAccountRelationship(client, crmContext(session), id, input);
    return ok({ rows }, 201);
  });
}
