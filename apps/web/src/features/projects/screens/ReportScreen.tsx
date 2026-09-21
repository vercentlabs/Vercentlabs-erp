"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, PageHeader, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TextField } from "@vercentlabs/design-system";

import { ProjectsApiError, readView } from "@/features/projects/shared/client";
import { ProjectsAlert, ProjectsPanel } from "@/features/projects/shared/ProjectsUi";
import { label, money } from "@/features/projects/shared/format";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

export const REPORTS: Record<string, { key: string; title: string; description: string }> = {
  portfolio: { key: "portfolio", title: "Project portfolio", description: "Every project with status, health, progress and (financial access only) budget, actual cost and margin." },
  "schedule-variance": { key: "schedule-variance", title: "Schedule variance", description: "Planned against baseline dates, per project." },
  "time-by-project": { key: "time-by-project", title: "Time by project", description: "Approved hours by project and person." },
  utilization: { key: "utilization", title: "Utilization", description: "Billable and non-billable hours against capacity per person." },
  "budget-vs-actual": { key: "budget-vs-actual", title: "Budget vs actual", description: "Approved budget, actual cost and variance per project (financial access only)." },
  "billing-status": { key: "billing-status", title: "Billing status", description: "Billing lines by state per project." },
  "risk-register": { key: "risk-register", title: "Risk register", description: "Open risks ranked by score." },
  "expense-summary": { key: "expense-summary", title: "Expense summary", description: "Expenses by project, category and status." },
  "overdue-work": { key: "overdue-work", title: "Overdue work", description: "Open tasks and milestones past their date." },
  "audit-trail": { key: "audit-trail", title: "Audit trail", description: "Every recorded change to a project (audit access only)." },
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const AMOUNTY = /(amount|debit|credit|balance|total|actual|budget|variance|outstanding|current|days|over|bucket)/i;
const cell = (key: string, value: unknown) => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" || (typeof value === "string" && AMOUNTY.test(key) && value !== "" && !Number.isNaN(Number(value)))) return money(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).slice(0, 200);
};

function RowsTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return <p className="text-sm text-text-muted">No data for this period.</p>;
  const columns = Object.keys(rows[0]).filter((k) => !/(^id$|_id$)/.test(k));
  return (
    <div className="overflow-x-auto">
      <Table className="w-full text-sm">
        <TableHead>
          <TableRow className="border-b border-border text-left text-text-muted">
            {columns.map((c) => <TableHeaderCell key={c} className="px-2 py-1 font-medium">{label(c)}</TableHeaderCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i} className="border-b border-border/50">
              {columns.map((c) => <TableCell key={c} className={`px-2 py-1 ${AMOUNTY.test(c) ? "text-right tabular-nums" : ""}`}>{cell(c, row[c])}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// One viewer for every project report: the domain returns a list of rows or an object of sections and
// scalars; each list becomes a table and each scalar a headline number.
export function ReportsScreen() {
  const workspace = useWorkspaceContext();
  const [name, setName] = useState("portfolio");
  const report = REPORTS[name];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" });
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "projects", "report", report?.key ?? "", applied.from, applied.to),
    queryFn: async () => (await readView<{ report: unknown }>("report", { key: report.key, from: applied.from || undefined, to: applied.to || undefined })).report,
  });
  const data = query.data;
  const sections: Array<[string, Array<Record<string, unknown>>]> = Array.isArray(data) ? [["", data as Array<Record<string, unknown>>]] : isRecord(data) ? Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v as Array<Record<string, unknown>>]) : [];
  const scalars = isRecord(data) ? Object.entries(data).filter(([, v]) => v !== null && typeof v !== "object") : [];
  const error = query.error instanceof ProjectsApiError ? query.error.message : query.isError ? "The report could not be loaded." : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" description={report.description} />
      <ProjectsPanel>
        <Select label="Report" options={Object.entries(REPORTS).map(([value, r]) => ({ value, label: r.title }))} selectedKey={name} onSelectionChange={(k) => setName(String(k))} />
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
          <TextField label="From" type="date" value={from} onChange={setFrom} />
          <TextField label="To" type="date" value={to} onChange={setTo} />
          <Button variant="primary" onPress={() => setApplied({ from, to })}>Run report</Button>
        </div>
      </ProjectsPanel>
      {error && <ProjectsAlert>{error}</ProjectsAlert>}
      {scalars.length > 0 && (
        <ProjectsPanel title="Summary">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {scalars.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-text-muted">{label(k)}</dt>
                <dd className="text-lg font-semibold tabular-nums">{cell(k, v)}</dd>
              </div>
            ))}
          </dl>
        </ProjectsPanel>
      )}
      {query.isLoading && <p className="text-sm text-text-muted">Loading…</p>}
      {sections.map(([k, rows]) => (
        <ProjectsPanel key={k || "rows"} title={k ? label(k) : undefined}>
          <RowsTable rows={rows} />
        </ProjectsPanel>
      ))}
    </div>
  );
}
