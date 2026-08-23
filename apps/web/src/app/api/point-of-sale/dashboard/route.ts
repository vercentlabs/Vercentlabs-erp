import { getPointOfSaleDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { pointOfSaleContext } from "@/modules/point-of-sale";

export async function GET() {
  try {
    const session = await requireModuleWorkspace("point-of-sale");
    const data = await tenantTransaction(session.organizationId, (client) =>
      getPointOfSaleDashboard(client, pointOfSaleContext(session)),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
