import { releaseWorkOrder } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { manufacturingContext } from "@/lib/manufacturing";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiWorkspace();
  const { id } = await params;
  const row = await tenantTransaction(session.organizationId, (client) =>
    releaseWorkOrder(client, manufacturingContext(session), id),
  );
  return NextResponse.json({ ok: true, row });
}
