import { postProduction } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { manufacturingContext } from "@/modules/manufacturing";
import { productionPostSchema } from "@/modules/manufacturing/validation";
import { requireModuleWorkspace } from "@/core/module-access";

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
