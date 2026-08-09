import { getPointOfSaleDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";
import { pointOfSaleContext } from "@/lib/point-of-sale";

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
