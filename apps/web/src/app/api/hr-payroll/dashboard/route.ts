import { getHrPayrollDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { hrPayrollContext } from "@/lib/hr-payroll";

export async function GET() {
  const session = await requireApiWorkspace();
  const data = await tenantTransaction(session.organizationId, (client) =>
    getHrPayrollDashboard(client, hrPayrollContext(session)),
  );
  return NextResponse.json({ ok: true, data });
}
