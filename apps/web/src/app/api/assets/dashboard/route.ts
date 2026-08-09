import { getAssetsDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { assetsContext } from "@/lib/assets";
import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";

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
