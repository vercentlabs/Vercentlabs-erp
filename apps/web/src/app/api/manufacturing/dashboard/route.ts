import { getManufacturingDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { manufacturingContext } from "@/modules/manufacturing";
import { requireModuleWorkspace } from "@/core/module-access";

export async function GET() {
  try {
    const session = await requireModuleWorkspace("manufacturing");
    const data = await tenantTransaction(session.organizationId, (client) =>
      getManufacturingDashboard(client, manufacturingContext(session)),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
