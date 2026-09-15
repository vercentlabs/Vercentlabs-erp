import { addContactAccountRelationship, assertSameOriginOrMobile, listContactAccountRelationships } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// F003 Stage A2 — listContactAccountRelationships/addContactAccountRelationship
// (contact-relationships.js) already governed a full multi-account Contact
// relationship model (tenant.crm_contact_account_relationships, migration
// 088) — organization scope, relationship/stakeholder role, primary
// semantics, audit, merge reconciliation — already tested
// (crm-contact-account-relationships-f003.test.mjs) with zero frontend
// consumer before this pass. Not a new migration; a wiring gap.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const rows = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return listContactAccountRelationships(client, crmContext(session), id);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.accountsManage);
      return addContactAccountRelationship(client, crmContext(session), id, input);
    });
    return ok({ rows }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
