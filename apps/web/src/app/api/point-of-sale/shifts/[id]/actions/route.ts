import { closeShift } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { pointOfSaleContext } from "@/modules/point-of-sale";
import { posShiftCloseSchema } from "@/modules/point-of-sale/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("point-of-sale");
    const { id } = await params;
    const input = posShiftCloseSchema.parse(await request.json());
    const row = await tenantTransaction(session.organizationId, (client) =>
      closeShift(client, pointOfSaleContext(session), id, input),
    );
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
