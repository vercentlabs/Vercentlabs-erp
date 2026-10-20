"use client";

// What every financial statement screen shares: the period (presets from the financial years, or any dates), the page around it with
// Print and Export, the check that it adds up, and a row that opens the account's ledger for the period.
import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { Breadcrumb, Button, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { amount, statementPeriods, type StatementPeriods } from "../api/statements-api";

export type Range = { preset: string; from: string; to: string };
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parse = (text: string) => new Date(`${text}T00:00:00`);

// The presets, worked out from today and the financial years.
export function presetRange(preset: string, periods: StatementPeriods | undefined): { from: string; to: string } | null {
  if (!periods) return null;
  const today = parse(periods.today);
  const y = today.getFullYear(); const m = today.getMonth();
  const quarterStart = new Date(y, Math.floor(m / 3) * 3, 1);
  const current = periods.current;
  const previous = current ? periods.years.find((year) => year.end < current.start) : null;
  switch (preset) {
    case "this_month": return { from: iso(new Date(y, m, 1)), to: periods.today };
    case "last_month": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "this_quarter": return { from: iso(quarterStart), to: periods.today };
    case "this_year": return current ? { from: current.start, to: periods.today } : { from: `${y}-01-01`, to: periods.today };
    case "last_year": return previous ? { from: previous.start, to: previous.end } : null;
    default: return null;
  }
}

export function usePeriods() {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "statement-periods"), queryFn: statementPeriods, staleTime: 300_000 });
}

export function PeriodControls({ range, onChange, periods, asOf = false }: { range: Range; onChange: (range: Range) => void; periods?: StatementPeriods; asOf?: boolean }) {
  const presets = asOf
    ? [["today", "Today"], ["end_last_month", "End of last month"], ["end_last_year", "End of last financial year"], ["custom", "A date"]]
    : [["this_month", "This month"], ["last_month", "Last month"], ["this_quarter", "This quarter"], ["this_year", periods?.current ? `${periods.current.name} to date` : "This financial year"],
        ["last_year", "Last financial year"], ["custom", "Custom dates"]];
  const pick = (preset: string) => {
    if (asOf) {
      if (!periods) return;
      const today = parse(periods.today);
      const previous = periods.current ? periods.years.find((year) => year.end < periods.current!.start) : null;
      const to = preset === "today" ? periods.today : preset === "end_last_month" ? iso(new Date(today.getFullYear(), today.getMonth(), 0)) : preset === "end_last_year" ? previous?.end ?? range.to : range.to;
      onChange({ preset, from: range.from, to });
      return;
    }
    const next = presetRange(preset, periods);
    onChange({ preset, from: next?.from ?? range.from, to: next?.to ?? range.to });
  };
  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <Select aria-label="Period" className="w-full sm:w-56" selectedKey={range.preset} onSelectionChange={(key) => pick(String(key))}
        options={presets.map(([value, label]) => ({ value, label }))} />
      {range.preset === "custom" && !asOf && <TextField aria-label="From" type="date" className="w-full sm:w-40" value={range.from} onChange={(from) => onChange({ ...range, from })} />}
      {range.preset === "custom" && <TextField aria-label={asOf ? "As of" : "To"} type="date" className="w-full sm:w-40" value={range.to} onChange={(to) => onChange({ ...range, to })} />}
    </div>
  );
}

export function StatementPage({ title, description, subtitle, onExport, controls, check, children }: {
  title: string; description: string; subtitle: string; onExport?: () => void; controls: ReactNode; check?: { balanced: boolean; exceptions: string[]; ok: string }; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 print:gap-2">
      <PageHeader
        breadcrumbs={[<Breadcrumb key="a" href="/accounting">Accounting</Breadcrumb>, <Breadcrumb key="b" isCurrent>{title}</Breadcrumb>]}
        title={title} description={description}
        primaryAction={<Button variant="secondary" onPress={() => window.print()}><Printer className="size-4" aria-hidden="true" />Print or save as PDF</Button>}
        secondaryActions={onExport ? <Button variant="ghost" onPress={onExport}><Download className="size-4" aria-hidden="true" />Export CSV</Button> : undefined}
      />
      {controls}
      <p className="text-sm font-medium text-text-secondary">{subtitle}</p>
      {check && (check.balanced
        ? <Notice tone="success">{check.ok}</Notice>
        : <Notice tone="danger">This statement doesn&apos;t add up — {check.exceptions.join(" ")} Look at Automatic Postings and the trial balance before relying on it.</Notice>)}
      {check && check.balanced && check.exceptions.length > 0 && <Notice tone="warning">{check.exceptions.join(" ")}</Notice>}
      {children}
    </div>
  );
}

export const periodText = (from: string, to: string) => `${formatDate(from)} – ${formatDate(to)}`;

export function AccountLink({ accountId, code, name, from, to }: { accountId: string; code: string; name: string; from?: string; to: string }) {
  return <Link className="text-text hover:text-brand hover:underline" href={`/accounting/ledger/${accountId}?${new URLSearchParams({ ...(from ? { from } : {}), to }).toString()}`}>
    <span className="tabular-nums text-text-muted">{code}</span> {name}</Link>;
}

export function Money({ value, strong, className = "" }: { value: number | null | undefined; strong?: boolean; className?: string }) {
  return <span className={`tabular-nums ${value !== null && value !== undefined && value < -0.004 ? "text-danger" : ""} ${strong ? "font-semibold text-text" : ""} ${className}`}>{amount(value)}</span>;
}

export function NoAccess() {
  return <PermissionState title="You don't have access to financial statements" description="Statements need the Accounting reports permission. Ask an administrator." />;
}
