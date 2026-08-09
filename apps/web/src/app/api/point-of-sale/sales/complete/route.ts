import { completePointOfSale } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";
import { pointOfSaleContext } from "@/lib/point-of-sale";
import { posSaleCompleteSchema } from "@/lib/point-of-sale-validation";

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
