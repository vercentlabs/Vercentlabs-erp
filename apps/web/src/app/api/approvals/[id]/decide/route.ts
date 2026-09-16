import { z } from "zod";

import { assertSameOriginOrMobile, decideApproval } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";

const decideSchema = z.object({
  decision: z.enum(["approved", "rejected", "cancelled"]),
  note: z.string().trim().max(2_000).optional().nullable(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const body = decideSchema.parse(await readJson(request));
    // decideApproval dispatches into module handlers (accounting/sales)
    // that query RLS-protected tenant.* tables — must run with tenant
    // context set, not a plain transaction.
    const result = await tenantTransaction(session.organizationId, (client) =>
      decideApproval(client, session, id, body),
    );
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
