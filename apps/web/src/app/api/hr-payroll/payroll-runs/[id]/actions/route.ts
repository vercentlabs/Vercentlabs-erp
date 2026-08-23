import { calculatePayrollRun, transitionPayrollRun } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { hrPayrollContext } from "@/modules/hr-payroll";
import { payrollActionSchema } from "@/modules/hr-payroll/validation";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("hr-payroll");
    const { id } = await params;
    const input = payrollActionSchema.parse(await request.json());

    const row = await tenantTransaction(session.organizationId, (client) => {
      if (input.action === "calculate") {
        return calculatePayrollRun(client, hrPayrollContext(session), id);
      }
      return transitionPayrollRun(client, hrPayrollContext(session), id, input);
    });

    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
