import { getQualityDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { qualityContext } from "@/lib/quality";

export async function GET() {
  const session = await requireApiWorkspace();
  const data = await tenantTransaction(session.organizationId, (client) =>
    getQualityDashboard(client, qualityContext(session)),
  );
  return NextResponse.json({ ok: true, data });
}
