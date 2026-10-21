import { listTodos } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// To-dos: the caller's tasks and follow-ups in one list. ?view=mine|overdue|today|upcoming|all&type=&search=&limit=&offset=
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const params = new URL(request.url).searchParams;
    return ok(await listTodos(client, crmContext(session, snapshot), {
      view: params.get("view") ?? undefined, type: params.get("type") ?? undefined, search: params.get("search") ?? undefined,
      limit: Number(params.get("limit")) || undefined, offset: Number(params.get("offset")) || undefined,
    }));
  });
}
