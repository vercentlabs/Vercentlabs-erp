import { closeShift } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { pointOfSaleContext } from "@/lib/point-of-sale";
import { posShiftCloseSchema } from "@/lib/point-of-sale-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiWorkspace();
  const { id } = await params;
  const input = posShiftCloseSchema.parse(await request.json());
  const row = await tenantTransaction(session.organizationId, (client) =>
    closeShift(client, pointOfSaleContext(session), id, input),
  );
  return NextResponse.json({ ok: true, row });
}
