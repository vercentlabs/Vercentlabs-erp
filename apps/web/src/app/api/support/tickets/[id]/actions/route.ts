import { assignSupportTicket, transitionSupportTicket } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";
import { supportContext } from "@/lib/support";
import { supportTicketActionSchema } from "@/lib/support-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("support");
    const { id } = await params;
    const input = supportTicketActionSchema.parse(await request.json());

    const row = await tenantTransaction(session.organizationId, (client) => {
      if (input.action === "assign") {
        return assignSupportTicket(client, supportContext(session), id, input);
      }
      return transitionSupportTicket(client, supportContext(session), id, input);
    });

    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
