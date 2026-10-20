import {
  closePayrollRun, exportPayrollReport, getPayrollReport, markPaymentException, postPayrollRunToFinance, publishPayslips, recordSalaryPayment, recordStatutoryPayment,
  statutoryOwed, unpostPayrollRun, PAYROLL_REPORTS,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { hrContext } from "@/features/hr/shared/hr-context";
import { hrMutation, hrRead } from "@/features/hr/shared/route-helpers";

// Payroll after approval: ?runId → its posting, payments and payslip payment states; ?report=kind (&from, &to, &format=csv) → a payroll
// report; ?owed=kind&month=YYYY-MM → what a month owes for TDS / EPF / ESI / PT. POST { action: post | unpost | publish | pay | exception |
// close | statutory, ... }.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  if (get("report") && get("format") === "csv") {
    return workspaceRoute(request, { module: "hr-payroll", permission: "hr_payroll.view" }, async ({ client, session }) => {
      const file = await exportPayrollReport(client, hrContext(session), get("report"), { from: get("from"), to: get("to") });
      return new Response(file.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
    });
  }
  return hrRead(request, async (client, context) => {
    if (get("report")) return getPayrollReport(client, context, get("report") as string, { from: get("from"), to: get("to") });
    if (get("owed")) return statutoryOwed(client, context, get("owed") as string, `${String(get("month")).slice(0, 7)}-01`);
    const banks = (await client.query(`SELECT id, code, name FROM tenant.accounting_accounts WHERE organization_id = $1 AND NOT is_group AND status = 'active' AND control_kind IN ('bank', 'cash') ORDER BY code`,
      [context.organizationId])).rows.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
    if (!get("runId")) return { banks, reports: Object.entries(PAYROLL_REPORTS).map(([value, label]) => ({ value, label })),
      challans: (await client.query(`SELECT kind, to_char(pay_month, 'YYYY-MM') AS month, challan_number, payment_date, amount FROM tenant.hr_statutory_payments WHERE organization_id = $1 ORDER BY payment_date DESC LIMIT 200`,
        [context.organizationId])).rows };
    const runId = get("runId") as string;
    const payments = (await client.query(`SELECT payment_number, payment_date, amount, method, reference FROM tenant.hr_salary_payments WHERE organization_id = $1 AND payroll_run_id = $2 ORDER BY created_at`,
      [context.organizationId, runId])).rows;
    const slips = (await client.query(`SELECT p.id, p.payslip_number, e.employee_number, e.first_name, e.last_name, p.net_pay, p.paid_amount, p.payment_status, p.payment_exception, p.status, p.published_at
      FROM tenant.hr_payslips p JOIN tenant.hr_employees e ON e.id = p.employee_id WHERE p.organization_id = $1 AND p.payroll_run_id = $2 AND p.status <> 'cancelled' ORDER BY p.payslip_number`,
      [context.organizationId, runId])).rows;
    const journal = (await client.query(`SELECT je.entry_number, je.status FROM tenant.accounting_postings ap JOIN tenant.accounting_journal_entries je ON je.id = ap.journal_entry_id
      WHERE ap.organization_id = $1 AND ap.posting_event = 'payroll_run' AND ap.source_id = $2 AND ap.status = 'POSTED'`, [context.organizationId, runId])).rows[0] ?? null;
    return { banks, payments, slips, journal };
  });
}
export async function POST(request: Request) {
  return hrMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const id = String(input.runId ?? "");
    switch (input.action) {
      case "post": return postPayrollRunToFinance(client, context, id, input);
      case "unpost": return unpostPayrollRun(client, context, id, input);
      case "publish": return publishPayslips(client, context, id);
      case "pay": return recordSalaryPayment(client, context, id, input);
      case "exception": return markPaymentException(client, context, String(input.payslipId ?? ""), input);
      case "close": return closePayrollRun(client, context, id);
      case "statutory": return recordStatutoryPayment(client, context, input);
      default: throw new HttpError(400, "Unknown action.");
    }
  });
}
