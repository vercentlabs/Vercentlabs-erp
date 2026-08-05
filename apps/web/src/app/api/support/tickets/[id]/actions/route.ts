import { assignSupportTicket, transitionSupportTicket } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { supportContext } from "@/lib/support";
import { supportTicketActionSchema } from "@/lib/support-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiWorkspace();
  const { id } = await params;
  const input = supportTicketActionSchema.parse(await request.json());

  const row = await tenantTransaction(session.organizationId, (client) => {
    if (input.action === "assign") {
      return assignSupportTicket(client, supportContext(session), id, input);
    }
    return transitionSupportTicket(client, supportContext(session), id, input);
  });

  return NextResponse.json({ ok: true, row });
}
