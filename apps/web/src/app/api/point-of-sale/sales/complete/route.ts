import { completePointOfSale } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { pointOfSaleContext } from "@/modules/point-of-sale";
import { posSaleCompleteSchema } from "@/modules/point-of-sale/validation";

export async function POST(request: Request) {
  try {
    const session = await requireModuleWorkspace("point-of-sale");
    const input = posSaleCompleteSchema.parse(await request.json());
    const row = await tenantTransaction(session.organizationId, (client) =>
      completePointOfSale(client, pointOfSaleContext(session), input),
    );
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
