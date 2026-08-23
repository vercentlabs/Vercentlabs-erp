import { getSupportDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { supportContext } from "@/modules/support";

export async function GET() {
  try {
    const session = await requireModuleWorkspace("support");
    const data = await tenantTransaction(session.organizationId, (client) =>
      getSupportDashboard(client, supportContext(session)),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
