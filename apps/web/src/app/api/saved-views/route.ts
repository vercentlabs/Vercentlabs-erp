import { z } from "zod";

import { listSavedListViews, saveSavedListView } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Saved list views: the caller's own and the company's shared views for one list (?list=sales.invoices).
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "saved_views.list" }, async ({ client, session }) =>
    ok(await listSavedListViews(client, session, new URL(request.url).searchParams.get("list") ?? "")));
}

const schema = z.object({
  listKey: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  state: z.record(z.string(), z.unknown()),
  shared: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function POST(request: Request) {
  return workspaceRoute(request, { action: "saved_views.save" }, async ({ client, session }) =>
    ok(await saveSavedListView(client, session, schema.parse(await readJson(request))), 201));
}
