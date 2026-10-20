"use client";

// Profit and loss: revenue, cost of sales and gross profit; operating expenses and operating profit; other income and expenses; net profit
// — for a period, beside the previous period or the same period last year. An account opens its ledger for the same dates.
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, Select } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { downloadCsv, errorMessage, errorStatus, profitAndLoss, type ProfitAndLoss } from "../api/statements-api";
import { AccountLink, Money, NoAccess, PeriodControls, StatementPage, periodText, presetRange, usePeriods, type Range } from "../components/StatementKit";

const SUBTOTALS: Record<string, { label: string; pick: (pl: ProfitAndLoss, compare: boolean) => number | null }> = {
  costOfSales: { label: "Gross profit", pick: (pl, compare) => (compare ? pl.compareTotals?.grossProfit ?? null : pl.grossProfit) },
  operatingExpenses: { label: "Operating profit", pick: (pl, compare) => (compare ? pl.compareTotals?.operatingProfit ?? null : pl.operatingProfit) },
};

export function ProfitLossScreen() {
  const workspace = useWorkspaceContext();
  const periods = usePeriods();
  const [chosen, setChosen] = useState<Range | null>(null);
  const [compare, setCompare] = useState("none");
  const range = chosen ?? (periods.data ? { preset: "this_year", ...presetRange("this_year", periods.data)! } : null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", "profit-and-loss", range?.from, range?.to, compare),
    queryFn: () => profitAndLoss({ from: range!.from, to: range!.to, compare: compare === "none" ? undefined : compare }), enabled: Boolean(range?.from && range?.to),
    placeholderData: (previous) => previous,
  });
  if (errorStatus(periods.error) === 403 || errorStatus(query.error) === 403) return <NoAccess />;
  if (periods.isLoading || !range) return <LoadingState label="Loading the profit and loss" rows={10} />;
  const pl = query.data;
  const comparing = Boolean(pl?.compare);
  const columns = ["", { label: pl ? periodText(pl.from, pl.to) : "This period", numeric: true }, ...(comparing && pl?.compare ? [{ label: periodText(pl.compare.from, pl.compare.to), numeric: true }] : [])];
  const exportCsv = () => pl && downloadCsv(`profit-and-loss-${pl.from}-to-${pl.to}.csv`, [
    ["Line", "This period", ...(comparing ? ["Comparison"] : [])],
    ...pl.sections.flatMap((section) => [
      ...section.lines.map((entry) => [`${entry.code} ${entry.name}`, entry.amount, ...(comparing ? [entry.compare] : [])]),
      [`Total ${section.label.toLowerCase()}`, section.total, ...(comparing ? [section.compareTotal] : [])],
      ...(SUBTOTALS[section.key] ? [[SUBTOTALS[section.key].label, SUBTOTALS[section.key].pick(pl, false), ...(comparing ? [SUBTOTALS[section.key].pick(pl, true)] : [])]] : []),
    ]),
    ["Net profit", pl.netProfit, ...(comparing ? [pl.compareTotals?.netProfit ?? null] : [])],
  ]);
  return (
    <StatementPage title="Profit & Loss" description="What the company earned and spent in the period. Year-end closing entries are left out, so a closed year still shows its profit."
      subtitle={pl ? periodText(pl.from, pl.to) : ""} onExport={pl ? exportCsv : undefined}
      controls={<div className="flex flex-wrap items-end gap-2"><PeriodControls range={range} onChange={setChosen} periods={periods.data} />
        <Select aria-label="Compare with" className="w-full sm:w-56 print:hidden" selectedKey={compare} onSelectionChange={(key) => setCompare(String(key))}
          options={[{ value: "none", label: "No comparison" }, { value: "previous_period", label: "Compare with the previous period" }, { value: "previous_year", label: "Compare with last year" }]} /></div>}
      check={pl ? { balanced: pl.balanced, exceptions: pl.exceptions, ok: `Net ${pl.netProfit >= 0 ? "profit" : "loss"} for the period: ₹${Math.abs(pl.netProfit).toLocaleString("en-IN", { minimumFractionDigits: 2 })}.` } : undefined}>
      {query.isLoading ? <LoadingState label="Loading the profit and loss" rows={10} /> : query.isError || !pl ? <ErrorState title="Could not load the profit and loss" description={errorMessage(query.error)} /> : (
        <LinesTable columns={columns}>
          {pl.sections.map((section) => (
            <Fragment key={section.key}>
              <tr className="bg-surface-muted/60"><Cell className="font-semibold text-text">{section.label}</Cell><Cell numeric>{" "}</Cell>{comparing && <Cell numeric>{" "}</Cell>}</tr>
              {section.lines.length === 0 && <tr><Cell className="pl-6 text-text-muted">Nothing in this period</Cell><Cell numeric><Money value={0} /></Cell>{comparing && <Cell numeric><Money value={0} /></Cell>}</tr>}
              {section.lines.map((entry) => (
                <tr key={entry.accountId}>
                  <Cell className="pl-6"><AccountLink accountId={entry.accountId} code={entry.code} name={entry.name} from={pl.from} to={pl.to} /></Cell>
                  <Cell numeric><Money value={entry.amount} /></Cell>{comparing && <Cell numeric><Money value={entry.compare} /></Cell>}
                </tr>
              ))}
              <tr><Cell className="font-medium">Total {section.label.toLowerCase()}</Cell><Cell numeric><Money value={section.total} strong /></Cell>{comparing && <Cell numeric><Money value={section.compareTotal} strong /></Cell>}</tr>
              {SUBTOTALS[section.key] && (
                <tr className="border-t-2 border-border-strong"><Cell className="font-semibold text-text">{SUBTOTALS[section.key].label}</Cell>
                  <Cell numeric><Money value={SUBTOTALS[section.key].pick(pl, false)} strong /></Cell>{comparing && <Cell numeric><Money value={SUBTOTALS[section.key].pick(pl, true)} strong /></Cell>}</tr>
              )}
            </Fragment>
          ))}
          <tr className="border-t-2 border-border-strong bg-surface-muted"><Cell className="text-base font-bold text-text">Net {pl.netProfit >= 0 ? "profit" : "loss"}</Cell>
            <Cell numeric><Money value={pl.netProfit} strong className="text-base" /></Cell>{comparing && <Cell numeric><Money value={pl.compareTotals?.netProfit} strong className="text-base" /></Cell>}</tr>
        </LinesTable>
      )}
    </StatementPage>
  );
}
