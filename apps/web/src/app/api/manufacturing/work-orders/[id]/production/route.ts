import { postProduction } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { manufacturingContext } from "@/lib/manufacturing";
import { productionPostSchema } from "@/lib/manufacturing-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiWorkspace();
  const { id } = await params;
  const input = productionPostSchema.parse(await request.json());
  const row = await tenantTransaction(session.organizationId, (client) =>
    postProduction(client, manufacturingContext(session), id, input),
  );
  return NextResponse.json({ ok: true, row });
}
