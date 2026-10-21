import { z } from "zod";

import { dismissWorkspaceGuide, getAccessibleModules, getWorkspaceGuide, reopenWorkspaceGuide } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The card on an app's main screen: Get started (owner and administrators) or Welcome (a new teammate). GET ?module=; POST
// { action: dismiss | reopen, guide, moduleKey }.
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "workspace.guide.view" }, async ({ client, session }) => {
    const moduleKey = new URL(request.url).searchParams.get("module") ?? "";
    const accessible = (await getAccessibleModules(client, session)).filter((m: { accessible: boolean }) => m.accessible).map((m: { moduleId: string }) => m.moduleId);
    return ok({ guide: await getWorkspaceGuide(client, session, moduleKey, accessible) });
  });
}
const schema = z.object({ action: z.enum(["dismiss", "reopen"]), guide: z.enum(["get_started", "welcome"]).optional(), moduleKey: z.string().max(40).optional() });
export async function POST(request: Request) {
  return workspaceRoute(request, { action: "workspace.guide.update" }, async ({ client, session }) => {
    const body = schema.parse(await readJson(request));
    return ok(body.action === "dismiss"
      ? await dismissWorkspaceGuide(client, session, { guide: body.guide ?? "get_started", moduleKey: body.moduleKey ?? "" })
      : await reopenWorkspaceGuide(client, session, body.moduleKey ?? ""));
  });
}
