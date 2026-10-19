import { z } from "zod";

import { transferOwnership } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ targetUserId: z.string().uuid(), password: z.string().min(1).max(500) });

// Hand ownership to another active member (the owner only; the service checks the password).
export async function POST(request: Request) {
  return workspaceRoute(request, { action: "organization.ownership.transfer", auditDenial: true }, async ({ client, session }) =>
    ok(await transferOwnership(client, session, schema.parse(await readJson(request)))));
}
