import { getActivityReport, getCrmPivot, getCrmTrends, getForecastByMonth, getPivotDefinitions, getTargetAttainment, setSalesTargets } from "@vercentlabs/api/crm";

import { fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// CRM › Reports, the reports added by the CRM plan (3.7): forecast, trends, pivot, activity and targets. Each counts only what the
// caller may open; the query string carries the report's own choices (months, interval, rows, columns, measure, from, to, teamId…).
type Params = { params: Promise<{ report: string }> };
const REPORTS = new Set(["forecast", "trends", "pivot", "pivot-definitions", "activity", "targets"]);

export async function GET(request: Request, { params }: Params) {
  const { report } = await params;
  if (!REPORTS.has(report)) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    const input = Object.fromEntries(new URL(request.url).searchParams.entries());
    if (report === "forecast") return ok({ report: await getForecastByMonth(client, context, input) });
    if (report === "trends") return ok({ report: await getCrmTrends(client, context, input) });
    if (report === "pivot") return ok({ report: await getCrmPivot(client, context, input) });
    if (report === "pivot-definitions") return ok({ definitions: getPivotDefinitions() });
    if (report === "activity") return ok({ report: await getActivityReport(client, context, input) });
    return ok({ report: await getTargetAttainment(client, context, input) });
  });
}

// PUT targets { month: "YYYY-MM", targets: [{ userId, metric, target | null }] }.
export async function PUT(request: Request, { params }: Params) {
  const { report } = await params;
  if (report !== "targets") return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok({ report: await setSalesTargets(client, crmContext(session, snapshot), { month: String(body.month ?? ""), targets: Array.isArray(body.targets) ? body.targets : [] }) });
  });
}
