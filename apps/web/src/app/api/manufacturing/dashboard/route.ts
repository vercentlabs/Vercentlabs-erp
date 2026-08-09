import { getManufacturingDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { manufacturingContext } from "@/lib/manufacturing";
import { requireModuleWorkspace } from "@/lib/module-access";

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
