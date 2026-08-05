import { getSupportDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { supportContext } from "@/lib/support";

export async function GET() {
  const session = await requireApiWorkspace();
  const data = await tenantTransaction(session.organizationId, (client) =>
    getSupportDashboard(client, supportContext(session)),
  );
  return NextResponse.json({ ok: true, data });
}
