import { calculatePayrollRun, transitionPayrollRun } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { hrPayrollContext } from "@/lib/hr-payroll";
import { payrollActionSchema } from "@/lib/hr-payroll-validation";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";

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
