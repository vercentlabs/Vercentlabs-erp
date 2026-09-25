import { getCustomer360ForCaller } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// F002 gap-closure: getCustomer360 (account-intelligence.js) already
// existed, fully built — one unified read spanning the Account, its
// hierarchy, its Contacts, and a merged timeline across CRM activities/
// communications, Opportunities, Sales quotations/orders, Accounting
// invoices/receipts, and support events — but had no route and no frontend
// caller anywhere in the app (confirmed by grep before this pass). Matches
// the hierarchy route's convention exactly: GET is module-access-only, the
// underlying service does its own not-found/scope handling.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const view = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return getCustomer360ForCaller(client, crmContext(session), id);
    });
    return ok({ view });
  } catch (error) {
    return errorResponse(error);
  }
}
