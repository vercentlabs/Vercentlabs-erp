import { getQualityDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { qualityContext } from "@/modules/quality";

export async function GET() {
  try {
    const session = await requireModuleWorkspace("quality");
    const data = await tenantTransaction(session.organizationId, (client) =>
      getQualityDashboard(client, qualityContext(session)),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
