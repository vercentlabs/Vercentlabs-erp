import { z } from "zod";

import { cancelWorkspaceClosure, requestWorkspaceClosure } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ password: z.string().min(1).max(500), confirmName: z.string().min(1).max(200) });

// Close the workspace after the waiting period (owner only; the service checks the password and the company's name).
export async function POST(request: Request) {
  return workspaceRoute(request, { action: "organization.closure.request", auditDenial: true }, async ({ client, session }) =>
    ok({ closure: await requestWorkspaceClosure(client, session, schema.parse(await readJson(request))) }));
}

export async function DELETE(request: Request) {
  return workspaceRoute(request, { action: "organization.closure.cancel" }, async ({ client, session }) => ok({ closure: await cancelWorkspaceClosure(client, session) }));
}
