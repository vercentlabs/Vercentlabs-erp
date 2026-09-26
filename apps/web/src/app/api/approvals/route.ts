import { listApprovalInbox } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The caller's approval inbox: own requests, requests assigned to them,
// unassigned requests they hold the business permission for, or everything
// with approvals.manage. Each row carries server-decided capabilities and a
// deep link only when the caller can open the owning module.
export async function GET(request: Request) {
  return workspaceRoute(request, { snapshot: true, action: "approvals.list", transaction: "none" }, async ({ client, session, snapshot }) => {
    const raw = new URL(request.url).searchParams.get("status") || "pending";
    const status = ["pending", "approved", "rejected", "cancelled", "all"].includes(raw) ? raw : "pending";
    return ok({ approvals: await listApprovalInbox(client, session, { status, accessibleModules: snapshot?.accessibleModules ?? [] }) });
  });
}
