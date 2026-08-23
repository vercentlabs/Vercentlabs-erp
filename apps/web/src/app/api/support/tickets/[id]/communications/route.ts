import { addSupportCommunication } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { supportContext } from "@/modules/support";
import { supportCommunicationCreateSchema } from "@/modules/support/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("support");
    const { id } = await params;
    const input = supportCommunicationCreateSchema.parse(await request.json());
    const row = await tenantTransaction(session.organizationId, (client) =>
      addSupportCommunication(client, supportContext(session), id, input),
    );
    return NextResponse.json({ ok: true, row }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
