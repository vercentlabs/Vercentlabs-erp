import { releaseWorkOrder } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { manufacturingContext } from "@/lib/manufacturing";
import { requireModuleWorkspace } from "@/lib/module-access";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("manufacturing");
    const { id } = await params;
    const row = await tenantTransaction(session.organizationId, (client) =>
      releaseWorkOrder(client, manufacturingContext(session), id),
    );
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
