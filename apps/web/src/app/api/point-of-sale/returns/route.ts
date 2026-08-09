import { createPointOfSaleReturn } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";
import { pointOfSaleContext } from "@/lib/point-of-sale";
import { posReturnCreateSchema } from "@/lib/point-of-sale-validation";

export async function POST(request: Request) {
  try {
    const session = await requireModuleWorkspace("point-of-sale");
    const input = posReturnCreateSchema.parse(await request.json());
    const row = await tenantTransaction(session.organizationId, (client) =>
      createPointOfSaleReturn(client, pointOfSaleContext(session), input),
    );
    return NextResponse.json({ ok: true, row }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
