import { z } from "zod";

import { deleteSavedListView, setSavedListViewDefault } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ isDefault: z.boolean() });

// Opens by default, or stops.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { action: "saved_views.default" }, async ({ client, session }) => {
    const { id } = await context.params;
    return ok(await setSavedListViewDefault(client, session, id, schema.parse(await readJson(request)).isDefault));
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { action: "saved_views.delete" }, async ({ client, session }) => {
    const { id } = await context.params;
    return ok(await deleteSavedListView(client, session, id));
  });
}
