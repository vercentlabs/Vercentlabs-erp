import { cancelPayrollInput, createPayrollInput, decidePayrollInput, listPayrollInputs } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { hrMutation, hrRead } from "@/features/hr/shared/route-helpers";

// Payroll › Variable pay: one-time earnings and deductions by month. POST { action: create | approve | reject | cancel, id?, ... }.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return hrRead(request, async (client, context) => ({
    rows: await listPayrollInputs(client, context, { month: q.get("month") || undefined, status: q.get("status") || undefined }),
    employees: (await client.query(`SELECT id, employee_number, first_name, last_name FROM tenant.hr_employees WHERE organization_id = $1 AND status <> 'draft' ORDER BY employee_number`,
      [context.organizationId])).rows.map((e) => ({ value: e.id, label: `${e.employee_number} · ${e.first_name} ${e.last_name ?? ""}`.trim() })),
  }));
}
export async function POST(request: Request) {
  return hrMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const id = String(input.id ?? "");
    switch (input.action) {
      case "create": return createPayrollInput(client, context, input);
      case "approve": return decidePayrollInput(client, context, id, { approve: true, note: input.note });
      case "reject": return decidePayrollInput(client, context, id, { approve: false, note: input.note });
      case "cancel": return cancelPayrollInput(client, context, id, input);
      default: throw new HttpError(400, "Unknown action.");
    }
  });
}
