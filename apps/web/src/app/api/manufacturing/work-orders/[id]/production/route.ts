import { postProduction } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { manufacturingContext } from "@/lib/manufacturing";
import { productionPostSchema } from "@/lib/manufacturing-validation";
import { requireModuleWorkspace } from "@/lib/module-access";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("manufacturing");
    const { id } = await params;
    const input = productionPostSchema.parse(await request.json());
    const row = await tenantTransaction(session.organizationId, (client) =>
      postProduction(client, manufacturingContext(session), id, input),
    );
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
