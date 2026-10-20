import { cancelAttendanceCorrection, decideAttendanceCorrection, listAttendanceCorrections, requestAttendanceCorrection } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { hrMutation, hrRead } from "@/features/hr/shared/route-helpers";

// HR › Attendance corrections: GET the corrections the viewer may see (?status). POST { action: request | approve | reject | cancel, id?, ... }.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return hrRead(request, async (client, context) => {
    const canPickEmployee = context.permissions?.includes("hr_payroll.attendance.manage") || context.roleSlugs?.includes("organization_owner");
    return {
      rows: await listAttendanceCorrections(client, context, { status: q.get("status") || undefined }),
      employees: canPickEmployee ? (await client.query(`SELECT id, employee_number, first_name, last_name FROM tenant.hr_employees WHERE organization_id = $1 AND status IN ('active', 'on_leave', 'on_notice') ORDER BY employee_number`,
        [context.organizationId])).rows.map((e) => ({ value: e.id, label: `${e.employee_number} · ${e.first_name} ${e.last_name ?? ""}`.trim() })) : [],
    };
  });
}
export async function POST(request: Request) {
  return hrMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const id = String(input.id ?? "");
    switch (input.action) {
      case "request": return requestAttendanceCorrection(client, context, { ...input, employeeId: input.employeeId || undefined });
      case "approve": return decideAttendanceCorrection(client, context, id, { approve: true, note: input.note as string | undefined });
      case "reject": return decideAttendanceCorrection(client, context, id, { approve: false, note: input.note as string | undefined });
      case "cancel": return cancelAttendanceCorrection(client, context, id);
      default: throw new HttpError(400, "Unknown action.");
    }
  });
}
