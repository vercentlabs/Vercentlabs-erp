import { z } from "zod";

import { resetMemberMfa } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

type Params = { params: Promise<{ id: string }> };
const schema = z.object({ reason: z.string().max(300).optional() });

// A member lost their phone: remove their authenticator (owner or system administrator).
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { action: "users.mfa.reset", auditDenial: true }, async ({ client, session }) =>
    ok(await resetMemberMfa(client, session, id, schema.parse(await readJson(request).catch(() => ({}))))));
}
