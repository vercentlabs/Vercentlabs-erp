import { z } from "zod";

import { getDataChecklist, setDataCutoverDate } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings › Bring your data: the steps with what is in already, and the cut-over date.
export async function GET(request: Request) {
  return workspaceRoute(request, { snapshot: true, action: "data_checklist.view" }, async ({ client, session, snapshot }) =>
    ok({ checklist: await getDataChecklist(client, session, snapshot?.accessibleModules ?? []) }));
}

const schema = z.object({ cutoverDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() });

export async function PUT(request: Request) {
  return workspaceRoute(request, { permission: "organization.manage", action: "data_checklist.cutover" }, async ({ client, session }) =>
    ok(await setDataCutoverDate(client, session, schema.parse(await readJson(request)).cutoverDate)));
}
