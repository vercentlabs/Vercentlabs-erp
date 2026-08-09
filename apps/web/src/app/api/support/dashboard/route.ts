import { getSupportDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";
import { supportContext } from "@/lib/support";

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
