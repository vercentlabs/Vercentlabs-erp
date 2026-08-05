import { getAssetsDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { assetsContext } from "@/lib/assets";

export async function GET() {
  const session = await requireApiWorkspace();
  const data = await tenantTransaction(session.organizationId, (client) =>
    getAssetsDashboard(client, assetsContext(session)),
  );
  return NextResponse.json({ ok: true, data });
}
