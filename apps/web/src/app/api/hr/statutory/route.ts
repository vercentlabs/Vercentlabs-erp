import {
  createStatutoryRule, listStatutoryRules, listStatutoryTemplates, listYtdOpenings, retireStatutoryRule, saveYtdOpening, updateStatutoryRule, verifyStatutoryRule,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { hrMutation, hrRead } from "@/features/hr/shared/route-helpers";

// Payroll › Statutory rules: the rule versions (EPF, ESI, PT by state, TDS), the templates, the opening year-to-date pay and the employees
// for its form. POST { action: create | update | verify | retire | ytd, id?, ... }.
export async function GET(request: Request) {
  const fy = new URL(request.url).searchParams.get("financialYear") || undefined;
  return hrRead(request, async (client, context) => ({
    rules: await listStatutoryRules(client, context), templates: listStatutoryTemplates(), ytd: await listYtdOpenings(client, context, { financialYear: fy }).catch(() => []),
    employees: (await client.query(`SELECT id, employee_number, first_name, last_name FROM tenant.hr_employees WHERE organization_id = $1 AND status <> 'draft' ORDER BY employee_number`,
      [context.organizationId])).rows.map((e) => ({ value: e.id, label: `${e.employee_number} · ${e.first_name} ${e.last_name ?? ""}`.trim() })),
  }));
}
export async function POST(request: Request) {
  return hrMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const id = String(input.id ?? "");
    switch (input.action) {
      case "create": return createStatutoryRule(client, context, input);
      case "update": return updateStatutoryRule(client, context, id, input);
      case "verify": return verifyStatutoryRule(client, context, id, input);
      case "retire": return retireStatutoryRule(client, context, id, input);
      case "ytd": return saveYtdOpening(client, context, input);
      default: throw new HttpError(400, "Unknown action.");
    }
  });
}
