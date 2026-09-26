import { createCrmAccount, listCrmAccounts } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F002 Accounts — NOT a CRM_RESOURCE_KEYS resource; business_parties is
// the shared cross-module master-data table, and listCrmAccounts/
// createCrmAccount (account-operations.js) are the CRM-specific governed
// layer over it (duplicate policy, sensitive-field projection, address
// upsert) — this route is thin by the same rule as the generic [resource]
// boundary, just against a different backend module.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const validStatus: "active" | "inactive" | "all" | undefined =
      status === "active" ? "active" : status === "inactive" ? "inactive" : status === "all" ? "all" : undefined;
    const options = {
      search: url.searchParams.get("search") || undefined,
      status: validStatus,
      industry: url.searchParams.get("industry") || undefined,
      country: url.searchParams.get("country") || undefined,
      ownerId: url.searchParams.get("ownerId") || undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
    };
    const result = await listCrmAccounts(client, crmContext(session), options);
    return ok(result);
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await createCrmAccount(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
