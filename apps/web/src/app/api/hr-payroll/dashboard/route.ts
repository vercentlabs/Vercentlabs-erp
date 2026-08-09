import { getHrPayrollDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { hrPayrollContext } from "@/lib/hr-payroll";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";

export async function GET() {
  try {
    const session = await requireModuleWorkspace("hr-payroll");
    const data = await tenantTransaction(session.organizationId, (client) =>
      getHrPayrollDashboard(client, hrPayrollContext(session)),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
