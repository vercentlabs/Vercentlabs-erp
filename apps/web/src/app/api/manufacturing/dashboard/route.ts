import { getManufacturingDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { manufacturingContext } from "@/lib/manufacturing";

export async function GET() {
  const session = await requireApiWorkspace();
  const data = await tenantTransaction(session.organizationId, (client) =>
    getManufacturingDashboard(client, manufacturingContext(session)),
  );
  return NextResponse.json({ ok: true, data });
}
