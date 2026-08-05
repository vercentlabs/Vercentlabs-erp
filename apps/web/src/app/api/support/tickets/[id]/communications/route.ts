import { addSupportCommunication } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { supportContext } from "@/lib/support";
import { supportCommunicationCreateSchema } from "@/lib/support-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiWorkspace();
  const { id } = await params;
  const input = supportCommunicationCreateSchema.parse(await request.json());
  const row = await tenantTransaction(session.organizationId, (client) =>
    addSupportCommunication(client, supportContext(session), id, input),
  );
  return NextResponse.json({ ok: true, row }, { status: 201 });
}
