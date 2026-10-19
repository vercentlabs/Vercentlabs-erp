import { listWorkspaceExports, requestWorkspaceExport } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The full workspace export (owner or system administrator; the service checks).
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "organization.export.list" }, async ({ client, session }) => ok({ exports: await listWorkspaceExports(client, session.organizationId) }));
}

export async function POST(request: Request) {
  return workspaceRoute(request, { action: "organization.export.request", auditDenial: true }, async ({ client, session }) => ok(await requestWorkspaceExport(client, session), 202));
}
