import { assertSameOriginOrMobile, createCrmContact, listCrmContacts } from "@vercentlabs/api";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const options = {
      search: url.searchParams.get("search") || undefined,
      accountId: url.searchParams.get("accountId") || undefined,
      status: url.searchParams.get("status") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    };
    const result = await withClient((client) => listCrmContacts(client, crmContext(session), options));
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, (client) => createCrmContact(client, crmContext(session), input));
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
