import { getAssetsDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { assetsContext } from "@/modules/assets";
import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";

export async function GET() {
  try {
    const session = await requireModuleWorkspace("assets");
    const data = await tenantTransaction(session.organizationId, (client) =>
      getAssetsDashboard(client, assetsContext(session)),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
