"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, PageHeader, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TextField } from "@vercentlabs/design-system";

import { AccountingApiError, readView } from "@/features/accounting/shared/client";
import { AccountingAlert, AccountingPanel } from "@/features/accounting/shared/AccountingUi";
import { label, money } from "@/features/accounting/shared/format";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

export const REPORTS: Record<string, { key: string; title: string; description: string; asOf?: boolean }> = {
  "trial-balance": { key: "trial-balance", title: "Trial balance", description: "Every account's debits, credits and balance over posted entries. Total debits always equal total credits." },
  "profit-loss": { key: "profit-and-loss", title: "Profit and loss", description: "Revenue less expenses over the period." },
  "balance-sheet": { key: "balance-sheet", title: "Balance sheet", description: "Assets, liabilities and equity as of the end date.", asOf: true },
  "cash-flow": { key: "cash-flow", title: "Cash flow", description: "Movement in cash accounts by category." },
  "general-ledger": { key: "general-ledger", title: "General ledger", description: "Every posted line, by account, with its entry and party." },
  "ar-aging": { key: "aged-receivables", title: "Receivables aging", description: "What customers owe, by how overdue it is.", asOf: true },
  "ap-aging": { key: "aged-payables", title: "Payables aging", description: "What is owed to suppliers, by how overdue it is.", asOf: true },
  "tax-reports": { key: "tax-summary", title: "Tax summary", description: "Output tax, input credit and withholding from the tax ledger." },
  "statutory-reports": { key: "subledger-reconciliation", title: "Subledger reconciliation", description: "Receivable and payable subledgers against their control accounts in the ledger." },
  "budget-actual": { key: "budget-vs-actual", title: "Budget vs actual", description: "Actual postings against the active budget." },
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

// One viewer for every accounting report: the domain returns a list of rows or an object of sections and
// scalars; each list becomes a table and each scalar a headline number.
export function ReportScreen({ name }: { name: string }) {
  const workspace = useWorkspaceContext();
  const report = REPORTS[name];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" });
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", "report", report?.key ?? "", applied.from, applied.to),
    enabled: Boolean(report),
    queryFn: async () => (await readView<{ report: unknown }>("report", { key: report.key, from: applied.from || undefined, to: applied.to || undefined, asOf: report.asOf ? applied.to || undefined : undefined })).report,
  });
  if (!report) return null;
  const data = query.data;
  const sections: Array<[string, Array<Record<string, unknown>>]> = Array.isArray(data) ? [["", data as Array<Record<string, unknown>>]] : isRecord(data) ? Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v as Array<Record<string, unknown>>]) : [];
  const scalars = isRecord(data) ? Object.entries(data).filter(([, v]) => v !== null && typeof v !== "object") : [];
  const error = query.error instanceof AccountingApiError ? query.error.message : query.isError ? "The report could not be loaded." : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={report.title} description={report.description} />
      <AccountingPanel>
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
          <TextField label="From" type="date" value={from} onChange={setFrom} />
          <TextField label={report.asOf ? "As of" : "To"} type="date" value={to} onChange={setTo} />
          <Button variant="primary" onPress={() => setApplied({ from, to })}>Run report</Button>
        </div>
      </AccountingPanel>
      {error && <AccountingAlert>{error}</AccountingAlert>}
      {scalars.length > 0 && (
        <AccountingPanel title="Summary">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {scalars.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-text-muted">{label(k)}</dt>
                <dd className="text-lg font-semibold tabular-nums">{cell(k, v)}</dd>
              </div>
            ))}
          </dl>
        </AccountingPanel>
      )}
      {query.isLoading && <p className="text-sm text-text-muted">Loading…</p>}
      {sections.map(([k, rows]) => (
        <AccountingPanel key={k || "rows"} title={k ? label(k) : undefined}>
          <RowsTable rows={rows} />
        </AccountingPanel>
      ))}
    </div>
  );
}
