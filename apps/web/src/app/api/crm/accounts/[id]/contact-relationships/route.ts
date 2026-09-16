import { listAccountContactRelationships } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// F003/F002 Stage A2 — the reverse view: which Contacts relate to this
// Account, with their role and primary flag. Same governed
// contact-relationships.js service, read-only here.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return listAccountContactRelationships(client, crmContext(session), id);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
