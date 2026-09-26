import { queryAuditEvents } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const FILTERS = ["actorUserId", "area", "eventType", "entityType", "entityId", "from", "to", "cursor"] as const;

// Organisation audit feed (read-only; there is no edit or delete API).
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.auditView, action: "audit.query", auditDenial: true },
    async ({ client, session }) => {
      const params = new URL(request.url).searchParams;
      const filters: Record<string, string> = {};
      for (const key of FILTERS) {
        const value = params.get(key);
        if (value) filters[key] = value;
      }
      return ok(await queryAuditEvents(client, session.organizationId, { ...filters, limit: Number(params.get("limit") || 50) }));
    },
  );
}
