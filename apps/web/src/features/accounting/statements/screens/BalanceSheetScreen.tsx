"use client";

// Balance sheet: what the company owns and owes at a date, and its equity — including profit not yet closed into retained earnings — with
// the check that assets equal liabilities plus equity, beside an earlier date. Suspense balances are called out. An account opens its ledger.
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, Select } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { balanceSheet, downloadCsv, errorMessage, errorStatus, type BalanceSheet, type BalanceSheetGroup } from "../api/statements-api";
import { AccountLink, Money, NoAccess, PeriodControls, StatementPage, usePeriods, type Range } from "../components/StatementKit";

export function BalanceSheetScreen() {
  const workspace = useWorkspaceContext();
  const periods = usePeriods();
  const [chosen, setChosen] = useState<Range | null>(null);
  const [compare, setCompare] = useState("none");
  const range = chosen ?? (periods.data ? { preset: "today", from: "", to: periods.data.today } : null);
  const previousYearEnd = periods.data?.current ? periods.data.years.find((year) => year.end < periods.data!.current!.start)?.end : undefined;
  const compareTo = compare === "year_end" ? previousYearEnd : compare === "month_end" && range ? (() => { const d = new Date(`${range.to}T00:00:00`); const end = new Date(d.getFullYear(), d.getMonth(), 0);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`; })() : undefined;
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", "balance-sheet", range?.to, compareTo),
    queryFn: () => balanceSheet({ asOf: range!.to, compareTo: compareTo && compareTo < range!.to ? compareTo : undefined }), enabled: Boolean(range?.to), placeholderData: (previous) => previous,
  });
  if (errorStatus(periods.error) === 403 || errorStatus(query.error) === 403) return <NoAccess />;
  if (periods.isLoading || !range) return <LoadingState label="Loading the balance sheet" rows={10} />;
  const bs = query.data;
  const comparing = Boolean(bs?.compareTo);
  const columns = ["", { label: bs ? formatDate(bs.asOf) : "", numeric: true }, ...(comparing && bs?.compareTo ? [{ label: formatDate(bs.compareTo), numeric: true }] : [])];
  const exportCsv = () => bs && downloadCsv(`balance-sheet-${bs.asOf}.csv`, csvRows(bs, comparing));
  return (
    <StatementPage title="Balance Sheet" description="What the company owns, what it owes and its equity at a date. Assets always equal liabilities plus equity."
      subtitle={bs ? `As of ${formatDate(bs.asOf)}` : ""} onExport={bs ? exportCsv : undefined}
      controls={<div className="flex flex-wrap items-end gap-2"><PeriodControls asOf range={range} onChange={setChosen} periods={periods.data} />
        <Select aria-label="Compare with" className="w-full sm:w-64 print:hidden" selectedKey={compare} onSelectionChange={(key) => setCompare(String(key))}
          options={[{ value: "none", label: "No comparison" }, { value: "month_end", label: "Compare with the previous month end" },
            ...(previousYearEnd ? [{ value: "year_end", label: "Compare with last financial year end" }] : [])]} /></div>}
      check={bs ? { balanced: bs.balanced, exceptions: bs.exceptions, ok: "Balanced: assets equal liabilities plus equity." } : undefined}>
      {query.isLoading ? <LoadingState label="Loading the balance sheet" rows={10} /> : query.isError || !bs ? <ErrorState title="Could not load the balance sheet" description={errorMessage(query.error)} /> : (
        <LinesTable columns={columns}>
          <Heading label="Assets" comparing={comparing} />
          {bs.assets.map((group) => <Group key={group.key} group={group} comparing={comparing} asOf={bs.asOf} />)}
          {bs.suspense && bs.suspense.total > 0 && <Group group={bs.suspense} comparing={comparing} asOf={bs.asOf} />}
          <Total label="Total assets" value={bs.totals.assets} compare={bs.compareTotals?.assets} comparing={comparing} />
          <Heading label="Liabilities" comparing={comparing} />
          {bs.liabilities.map((group) => <Group key={group.key} group={group} comparing={comparing} asOf={bs.asOf} />)}
          {bs.suspense && bs.suspense.total < 0 && <Group group={{ ...bs.suspense, total: -bs.suspense.total, lines: bs.suspense.lines.map((entry) => ({ ...entry, amount: -entry.amount, compare: entry.compare === null ? null : -entry.compare })) }} comparing={comparing} asOf={bs.asOf} />}
          <Total label="Total liabilities" value={bs.totals.liabilities} compare={bs.compareTotals?.liabilities} comparing={comparing} />
          <Heading label="Equity" comparing={comparing} />
          {bs.equity.lines.map((entry) => (
            <tr key={entry.accountId}><Cell className="pl-6"><AccountLink accountId={entry.accountId} code={entry.code} name={entry.name} to={bs.asOf} /></Cell>
              <Cell numeric><Money value={entry.amount} /></Cell>{comparing && <Cell numeric><Money value={entry.compare} /></Cell>}</tr>
          ))}
          {bs.equity.extras.map((entry) => (
            <tr key={entry.key}><Cell className="pl-6 italic text-text-secondary">{entry.label}</Cell><Cell numeric><Money value={entry.amount} /></Cell>{comparing && <Cell numeric><Money value={entry.compare} /></Cell>}</tr>
          ))}
          <Total label="Total equity" value={bs.totals.equity} compare={bs.compareTotals?.equity} comparing={comparing} />
          <tr className="border-t-2 border-border-strong bg-surface-muted"><Cell className="text-base font-bold text-text">Total liabilities and equity</Cell>
            <Cell numeric><Money value={bs.totals.liabilitiesAndEquity} strong className="text-base" /></Cell>{comparing && <Cell numeric><Money value={bs.compareTotals?.liabilitiesAndEquity} strong className="text-base" /></Cell>}</tr>
        </LinesTable>
      )}
    </StatementPage>
  );
}

function Heading({ label, comparing }: { label: string; comparing: boolean }) {
  return <tr className="bg-surface-muted"><Cell className="text-base font-bold text-text">{label}</Cell><Cell numeric>{" "}</Cell>{comparing && <Cell numeric>{" "}</Cell>}</tr>;
}

function Total({ label, value, compare, comparing }: { label: string; value: number; compare?: number; comparing: boolean }) {
  return <tr className="border-t-2 border-border-strong"><Cell className="font-semibold text-text">{label}</Cell><Cell numeric><Money value={value} strong /></Cell>
    {comparing && <Cell numeric><Money value={compare} strong /></Cell>}</tr>;
}

function Group({ group, comparing, asOf }: { group: BalanceSheetGroup; comparing: boolean; asOf: string }) {
  return (
    <Fragment>
      <tr><Cell className="font-medium text-text">{group.label}</Cell><Cell numeric><Money value={group.total} /></Cell>{comparing && <Cell numeric><Money value={group.compareTotal} /></Cell>}</tr>
      {group.lines.map((entry) => (
        <tr key={entry.accountId} className="text-text-secondary"><Cell className="pl-8"><AccountLink accountId={entry.accountId} code={entry.code} name={entry.name} to={asOf} /></Cell>
          <Cell numeric><Money value={entry.amount} /></Cell>{comparing && <Cell numeric><Money value={entry.compare} /></Cell>}</tr>
      ))}
    </Fragment>
  );
}

function csvRows(bs: BalanceSheet, comparing: boolean) {
  const row = (label: string, value: number | null | undefined, compare?: number | null) => [label, value ?? null, ...(comparing ? [compare ?? null] : [])];
  const group = (entry: BalanceSheetGroup) => [row(entry.label, entry.total, entry.compareTotal), ...entry.lines.map((line) => row(`  ${line.code} ${line.name}`, line.amount, line.compare))];
  return [
    ["Line", bs.asOf, ...(comparing ? [bs.compareTo ?? ""] : [])],
    ["Assets"], ...bs.assets.flatMap(group), row("Total assets", bs.totals.assets, bs.compareTotals?.assets),
    ["Liabilities"], ...bs.liabilities.flatMap(group), row("Total liabilities", bs.totals.liabilities, bs.compareTotals?.liabilities),
    ["Equity"], ...bs.equity.lines.map((line) => row(`  ${line.code} ${line.name}`, line.amount, line.compare)), ...bs.equity.extras.map((entry) => row(`  ${entry.label}`, entry.amount, entry.compare)),
    row("Total equity", bs.totals.equity, bs.compareTotals?.equity), row("Total liabilities and equity", bs.totals.liabilitiesAndEquity, bs.compareTotals?.liabilitiesAndEquity),
  ];
}
