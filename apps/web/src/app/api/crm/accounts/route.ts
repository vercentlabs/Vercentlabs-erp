import { assertSameOriginOrMobile, createCrmAccount, listCrmAccounts } from "@vercentlabs/api";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

// F002 Accounts — NOT a CRM_RESOURCE_KEYS resource; business_parties is
// the shared cross-module master-data table, and listCrmAccounts/
// createCrmAccount (account-operations.js) are the CRM-specific governed
// layer over it (duplicate policy, sensitive-field projection, address
// upsert) — this route is thin by the same rule as the generic [resource]
// boundary, just against a different backend module.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const validStatus: "active" | "inactive" | "all" | undefined =
      status === "active" ? "active" : status === "inactive" ? "inactive" : status === "all" ? "all" : undefined;
    const options = {
      search: url.searchParams.get("search") || undefined,
      status: validStatus,
      industry: url.searchParams.get("industry") || undefined,
      country: url.searchParams.get("country") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    };
    const result = await withClient((client) => listCrmAccounts(client, crmContext(session), options));
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
    const record = await tenantTransaction(session.organizationId, (client) => createCrmAccount(client, crmContext(session), input));
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
