import { z } from "zod";

import { decideApproval } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({
  decision: z.enum(["approved", "rejected", "cancelled"]),
  note: z.string().trim().max(2_000).optional().nullable(),
  expectedVersion: z.number().int().positive().optional().nullable(),
});

// One tenant transaction: the owning business module (reached through the
// orchestration registry) changes its document and closes the shared request;
// a failure leaves the request pending. Approve/reject apply the business
// write gate inside decideApproval; cancellation does not.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { snapshot: true, action: "approvals.decide", auditDenial: true }, async ({ client, session, snapshot }) => {
    const { id } = await context.params;
    const body = schema.parse(await readJson(request));
    return ok(await decideApproval(client, session, id, body, { accessibleModules: snapshot?.accessibleModules ?? [], env: process.env }));
  });
}
