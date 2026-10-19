import { listImporters } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The shared imports (Settings › Bring your data) this person may use: only apps the company has, and their permission.
export async function GET(request: Request) {
  return workspaceRoute(request, { snapshot: true, action: "imports.list" }, async ({ session, snapshot }) =>
    ok({ importers: listImporters(session, snapshot?.accessibleModules ?? []) }));
}
