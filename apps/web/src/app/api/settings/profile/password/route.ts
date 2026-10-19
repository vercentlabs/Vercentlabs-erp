import { z } from "zod";

import { changeOwnPassword } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ currentPassword: z.string().min(1).max(500), newPassword: z.string().min(1).max(500) });

export async function POST(request: Request) {
  return workspaceRoute(request, { action: "profile.password.change", auditDenial: true }, async ({ client, session }) =>
    ok(await changeOwnPassword(client, session, schema.parse(await readJson(request)))));
}
