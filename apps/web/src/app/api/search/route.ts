import { searchRecords } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Global record search. Providers run only for modules the caller can use
// (snapshot) and each one applies its module's own record scope. Tenant
// transaction: providers read tenant tables. Never billing-gated.
export async function GET(request: Request) {
  return workspaceRoute(request, { snapshot: true, action: "search.records" }, async ({ client, session, snapshot }) =>
    ok(await searchRecords(client, session, { query: new URL(request.url).searchParams.get("q") ?? "", accessibleModules: snapshot?.accessibleModules ?? [] })),
  );
}
