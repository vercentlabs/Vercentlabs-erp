import { completePointOfSale } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { pointOfSaleContext } from "@/lib/point-of-sale";
import { posSaleCompleteSchema } from "@/lib/point-of-sale-validation";

export async function POST(request: Request) {
  const session = await requireApiWorkspace();
  const input = posSaleCompleteSchema.parse(await request.json());
  const row = await tenantTransaction(session.organizationId, (client) =>
    completePointOfSale(client, pointOfSaleContext(session), input),
  );
  return NextResponse.json({ ok: true, row });
}
