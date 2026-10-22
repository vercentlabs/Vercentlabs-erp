import { listTodos } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// To-dos: the caller's tasks and follow-ups in one list. ?scope=mine|everyone&queue=overdue|today|upcoming|open&type=&search=&limit=&offset=
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const params = new URL(request.url).searchParams;
    return ok(await listTodos(client, crmContext(session, snapshot), {
      scope: params.get("scope") ?? undefined, queue: params.get("queue") ?? undefined, type: params.get("type") ?? undefined, search: params.get("search") ?? undefined,
      limit: Number(params.get("limit")) || undefined, offset: Number(params.get("offset")) || undefined,
    }));
  });
}
