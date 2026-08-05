import { createPointOfSaleReturn } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { pointOfSaleContext } from "@/lib/point-of-sale";
import { posReturnCreateSchema } from "@/lib/point-of-sale-validation";

export async function POST(request: Request) {
  const session = await requireApiWorkspace();
  const input = posReturnCreateSchema.parse(await request.json());
  const row = await tenantTransaction(session.organizationId, (client) =>
    createPointOfSaleReturn(client, pointOfSaleContext(session), input),
  );
  return NextResponse.json({ ok: true, row }, { status: 201 });
}
