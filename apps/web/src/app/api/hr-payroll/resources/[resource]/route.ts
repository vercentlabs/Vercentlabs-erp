import {
  createEmployee,
  createLeaveRequest,
  createPayrollRun,
  listHrPayrollResource,
} from "@vercentlabs/api";
import { NextRequest, NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { hrPayrollContext } from "@/lib/hr-payroll";
import {
  employeeCreateSchema,
  leaveRequestCreateSchema,
  payrollRunCreateSchema,
} from "@/lib/hr-payroll-validation";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await requireModuleWorkspace("hr-payroll");
    const { resource } = await params;
    const rows = await tenantTransaction(session.organizationId, (client) =>
      listHrPayrollResource(client, hrPayrollContext(session), resource, {
        employeeId: request.nextUrl.searchParams.get("employeeId"),
        limit: Number(request.nextUrl.searchParams.get("limit") || 100),
        offset: Number(request.nextUrl.searchParams.get("offset") || 0),
      }),
    );
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await requireModuleWorkspace("hr-payroll");
    const { resource } = await params;
    const body = await request.json();

    const row = await tenantTransaction(session.organizationId, (client) => {
      if (resource === "employees") {
        return createEmployee(
          client,
          hrPayrollContext(session),
          employeeCreateSchema.parse(body),
        );
      }
      if (resource === "leave-requests") {
        return createLeaveRequest(
          client,
          hrPayrollContext(session),
          leaveRequestCreateSchema.parse(body),
        );
      }
      if (resource === "payroll-runs") {
        return createPayrollRun(
          client,
          hrPayrollContext(session),
          payrollRunCreateSchema.parse(body),
        );
      }
      throw new Error("Creation is not supported for this resource.");
    });

    return NextResponse.json({ ok: true, row }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
