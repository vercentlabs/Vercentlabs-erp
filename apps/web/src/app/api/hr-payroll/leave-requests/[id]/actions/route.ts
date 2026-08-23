import { reviewLeaveRequest } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { hrPayrollContext } from "@/modules/hr-payroll";
import { leaveActionSchema } from "@/modules/hr-payroll/validation";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("hr-payroll");
    const { id } = await params;
    const input = leaveActionSchema.parse(await request.json());
    const row = await tenantTransaction(session.organizationId, (client) =>
      reviewLeaveRequest(client, hrPayrollContext(session), id, input),
    );
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
