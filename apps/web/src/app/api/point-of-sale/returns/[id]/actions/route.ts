import {
  approvePointOfSaleReturn,
  completePointOfSaleReturn,
} from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { pointOfSaleContext } from "@/modules/point-of-sale";
import { posReturnActionSchema } from "@/modules/point-of-sale/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("point-of-sale");
    const { id } = await params;
    const input = posReturnActionSchema.parse(await request.json());
    const context = pointOfSaleContext(session);
    const row = await tenantTransaction(session.organizationId, (client) =>
      input.action === "approve"
        ? approvePointOfSaleReturn(client, context, id, input)
        : completePointOfSaleReturn(client, context, id, input),
    );
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
