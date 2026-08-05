import { getPointOfSaleDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { pointOfSaleContext } from "@/lib/point-of-sale";

export async function GET() {
  const session = await requireApiWorkspace();
  const data = await tenantTransaction(session.organizationId, (client) =>
    getPointOfSaleDashboard(client, pointOfSaleContext(session)),
  );
  return NextResponse.json({ ok: true, data });
}
