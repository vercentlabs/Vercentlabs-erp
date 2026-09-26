import { getCustomer360ForCaller } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F002 gap-closure: getCustomer360 (account-intelligence.js) already
// existed, fully built — one unified read spanning the Account, its
// hierarchy, its Contacts, and a merged timeline across CRM activities/
// communications, Opportunities, Sales quotations/orders, Accounting
// invoices/receipts, and support events — but had no route and no frontend
// caller anywhere in the app (confirmed by grep before this pass). Matches
// the hierarchy route's convention exactly: GET is module-access-only, the
// underlying service does its own not-found/scope handling.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const view = await getCustomer360ForCaller(client, crmContext(session), id);
    return ok({ view });
  });
}
