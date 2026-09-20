"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MetricStrip, NumberField, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { HrApiError, readView, type Row } from "@/features/hr/shared/client";
import { amount, calendarDate, label } from "@/features/hr/shared/format";
import { HrPanel } from "@/features/hr/shared/HrUi";

// F445: per-employee statutory totals for one payroll run.
export function StatutoryReportScreen({ runId }: { runId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "statutory-report", runId), queryFn: () => readView<{ report: Row }>("statutory-report", { runId }).then((r) => r.report) });
  if (query.isError) return <PermissionState title="You don't have access to statutory reports" description="Ask an administrator to grant hr_payroll.reports.view." />;
  const r = query.data;
  if (!r) return <p className="text-sm text-text-muted">Loading…</p>;
  const t = r.totals as Row;
  const rows = r.employees as Row[];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`Statutory report — ${String(r.payrollNumber)}`} description="Per-employee statutory deductions and employer contributions for this payroll." />
      <MetricStrip metrics={[{ label: "PF (employee)", value: amount(t.pfEmployee) }, { label: "PF (employer)", value: amount(t.pfEmployer) }, { label: "ESIC (employee)", value: amount(t.esicEmployee) }, { label: "ESIC (employer)", value: amount(t.esicEmployer) }, { label: "Professional tax", value: amount(t.pt) }, { label: "LWF (employee)", value: amount(t.lwfEmployee) }, { label: "LWF (employer)", value: amount(t.lwfEmployer) }, { label: "TDS", value: amount(t.tds) }]} />
      <HrPanel title="By employee">
        {rows.length === 0 ? <p className="text-sm text-text-muted">No statutory deductions in this payroll.</p> : (
          <ul className="text-sm" aria-label="Statutory report by employee">
            {rows.map((e) => (
              <li key={String(e.employeeNumber)}>{String(e.employeeName)} ({String(e.employeeNumber)}) — PF {amount(e.pfEmployee)}, ESIC {amount(e.esicEmployee)}, PT {amount(e.pt)}, LWF {amount(e.lwfEmployee)}, TDS {amount(e.tds)}</li>
            ))}
          </ul>
        )}
      </HrPanel>
    </div>
  );
}

// F447: the month's compliance summary across every payroll run, with due dates.
export function ComplianceReportScreen() {
  const workspace = useWorkspaceContext();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "compliance-report", String(year), String(month)), queryFn: () => readView<{ report: Row }>("compliance-report", { year: String(year), month: String(month) }).then((r) => r.report) });
  if (query.isError && query.error instanceof HrApiError && query.error.status === 403) return <PermissionState title="You don't have access to compliance reports" description="Ask an administrator to grant hr_payroll.reports.view." />;
  const r = query.data;
  const t = (r?.totals ?? {}) as Row;
  const dueDates = (r?.dueDates ?? []) as Row[];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Payroll compliance report" description="What is owed to each statutory authority for the month, and when it is due. Covers every regular payroll run in the month; a run still open is flagged." />
      <div className="flex flex-wrap items-end gap-3">
        <NumberField label="Year" value={year} minValue={2000} step={1} onChange={(n) => setYear(Number.isNaN(n) ? year : n)} />
        <NumberField label="Month" value={month} minValue={1} maxValue={12} step={1} onChange={(n) => setMonth(Number.isNaN(n) ? month : n)} />
      </div>
      {r && (
        <>
          <MetricStrip metrics={[{ label: "PF total", value: amount(Number(t.pfEmployee ?? 0) + Number(t.pfEmployer ?? 0)) }, { label: "ESIC total", value: amount(Number(t.esicEmployee ?? 0) + Number(t.esicEmployer ?? 0)) }, { label: "Professional tax", value: amount(t.pt) }, { label: "LWF total", value: amount(Number(t.lwfEmployee ?? 0) + Number(t.lwfEmployer ?? 0)) }, { label: "TDS", value: amount(t.tds) }, { label: "Payroll closed", value: r.payrollRunsClosed ? "Yes" : "No" }]} />
          <HrPanel title="Due dates">
            {dueDates.length === 0 ? <p className="text-sm text-text-muted">No statutory components configured.</p> : (
              <ul className="text-sm" aria-label="Compliance due dates">
                {dueDates.map((d) => <li key={String(d.code)}>{String(d.name)} ({label(d.type)}) — {d.dueDate ? `due ${calendarDate(d.dueDate)}` : "no due day set"}</li>)}
              </ul>
            )}
          </HrPanel>
          <p className="text-xs text-text-muted">Runs included: {(r.runsIncluded as string[]).join(", ") || "none"}.</p>
        </>
      )}
    </div>
  );
}
