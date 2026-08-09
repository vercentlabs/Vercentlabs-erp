import { getQualityDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";
import { qualityContext } from "@/lib/quality";

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
