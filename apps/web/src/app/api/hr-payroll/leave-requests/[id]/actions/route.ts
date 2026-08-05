import { reviewLeaveRequest } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { hrPayrollContext } from "@/lib/hr-payroll";
import { leaveActionSchema } from "@/lib/hr-payroll-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiWorkspace();
  const { id } = await params;
  const input = leaveActionSchema.parse(await request.json());
  const row = await tenantTransaction(session.organizationId, (client) =>
    reviewLeaveRequest(client, hrPayrollContext(session), id, input),
  );
  return NextResponse.json({ ok: true, row });
}
