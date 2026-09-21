"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { AssetsApiError, readView } from "@/features/assets/shared/client";
import { AssetsAlert, AssetsPanel } from "@/features/assets/shared/AssetsUi";
import { label, money } from "@/features/assets/shared/format";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

export const REPORTS: Record<string, { key: string; title: string; description: string }> = {
  register: { key: "register", title: "Asset register", description: "Cost, accumulated depreciation and net book value by asset (financial access only)." },
  "category-summary": { key: "category-summary", title: "By category", description: "Asset counts and net book value per category." },
  depreciation: { key: "depreciation", title: "Depreciation", description: "Scheduled and posted depreciation by category and period." },
  reconciliation: { key: "reconciliation", title: "Register to ledger", description: "The register's cost and accumulated depreciation against what Assets has posted to the general ledger, per category." },
  "maintenance-cost": { key: "maintenance-cost", title: "Maintenance cost", description: "Completed maintenance by asset and type, with labour, parts, external cost and downtime." },
  downtime: { key: "downtime", title: "Downtime", description: "Hours unavailable by asset and category." },
  "warranty-expiry": { key: "warranty-expiry", title: "Warranty expiry", description: "Warranties by days remaining." },
  "calibration-due": { key: "calibration-due", title: "Calibration due", description: "Equipment by calibration due date." },
  disposals: { key: "disposals", title: "Disposals and gain/loss", description: "Completed disposals with their gain or loss." },
  "audit-trail": { key: "audit-trail", title: "Audit trail", description: "Every recorded change to an asset (audit access only)." },
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const AMOUNTY = /(amount|debit|credit|balance|total|actual|budget|variance|outstanding|current|days|over|bucket)/i;
const cell = (key: string, value: unknown) => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" || (typeof value === "string" && AMOUNTY.test(key) && value !== "" && !Number.isNaN(Number(value)))) return money(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).slice(0, 200);
};

function Table({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return <p className="text-sm text-text-muted">No data for this period.</p>;
  const columns = Object.keys(rows[0]).filter((k) => !/(^id$|_id$)/.test(k));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-text-muted">
            {columns.map((c) => <th key={c} className="px-2 py-1 font-medium">{label(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50">
              {columns.map((c) => <td key={c} className={`px-2 py-1 ${AMOUNTY.test(c) ? "text-right tabular-nums" : ""}`}>{cell(c, row[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One viewer for every accounting report: the domain returns a list of rows or an object of sections and
// scalars; each list becomes a table and each scalar a headline number.
export function ReportsScreen() {
  const workspace = useWorkspaceContext();
  const [name, setName] = useState("register");
  const report = REPORTS[name];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" });
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "assets", "report", report?.key ?? "", applied.from, applied.to),
    queryFn: async () => (await readView<{ report: unknown }>("report", { key: report.key, from: applied.from || undefined, to: applied.to || undefined })).report,
  });
  const data = query.data;
  const sections: Array<[string, Array<Record<string, unknown>>]> = Array.isArray(data) ? [["", data as Array<Record<string, unknown>>]] : isRecord(data) ? Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v as Array<Record<string, unknown>>]) : [];
  const scalars = isRecord(data) ? Object.entries(data).filter(([, v]) => v !== null && typeof v !== "object") : [];
  const error = query.error instanceof AssetsApiError ? query.error.message : query.isError ? "The report could not be loaded." : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" description={report.description} />
      <AssetsPanel>
        <Select label="Report" options={Object.entries(REPORTS).map(([value, r]) => ({ value, label: r.title }))} selectedKey={name} onSelectionChange={(k) => setName(String(k))} />
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
          <TextField label="From" type="date" value={from} onChange={setFrom} />
          <TextField label="To" type="date" value={to} onChange={setTo} />
          <Button variant="primary" onPress={() => setApplied({ from, to })}>Run report</Button>
        </div>
      </AssetsPanel>
      {error && <AssetsAlert>{error}</AssetsAlert>}
      {scalars.length > 0 && (
        <AssetsPanel title="Summary">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {scalars.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-text-muted">{label(k)}</dt>
                <dd className="text-lg font-semibold tabular-nums">{cell(k, v)}</dd>
              </div>
            ))}
          </dl>
        </AssetsPanel>
      )}
      {query.isLoading && <p className="text-sm text-text-muted">Loading…</p>}
      {sections.map(([k, rows]) => (
        <AssetsPanel key={k || "rows"} title={k ? label(k) : undefined}>
          <Table rows={rows} />
        </AssetsPanel>
      ))}
    </div>
  );
}
