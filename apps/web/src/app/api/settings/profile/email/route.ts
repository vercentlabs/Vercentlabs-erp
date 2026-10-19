import { z } from "zod";

import { requestEmailChange } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ newEmail: z.string().min(3).max(320), password: z.string().min(1).max(500) });

// Start changing the sign-in email: a confirmation link goes to the new address.
export async function POST(request: Request) {
  return workspaceRoute(request, { action: "profile.email.change", auditDenial: true }, async ({ client, session }) =>
    ok(await requestEmailChange(client, session, schema.parse(await readJson(request)))));
}
