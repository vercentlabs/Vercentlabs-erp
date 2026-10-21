import { z } from "zod";

import { rememberLastModule } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The app someone is using (signing in later returns them to it).
const schema = z.object({ moduleKey: z.string().max(40) });
export async function POST(request: Request) {
  return workspaceRoute(request, { action: "workspace.last_app.update" }, async ({ client, session }) => {
    await rememberLastModule(client, session, schema.parse(await readJson(request)).moduleKey);
    return ok({ saved: true });
  });
}
