import { getHrPayrollDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { hrPayrollContext } from "@/modules/hr-payroll";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";

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
