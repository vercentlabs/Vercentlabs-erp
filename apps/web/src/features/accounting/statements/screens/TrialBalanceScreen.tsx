"use client";

// Trial balance: every account with its balance before the period, the period's debits and credits, and its balance at the end — each
// pair of columns adding up. An account opens its ledger for the same dates.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox, ErrorState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { downloadCsv, errorMessage, errorStatus, trialBalance } from "../api/statements-api";
import { AccountLink, Money, NoAccess, PeriodControls, StatementPage, periodText, presetRange, usePeriods, type Range } from "../components/StatementKit";

export function TrialBalanceScreen() {
  const workspace = useWorkspaceContext();
  const periods = usePeriods();
  const [chosen, setChosen] = useState<Range | null>(null);
  const [showZero, setShowZero] = useState(false);
  const range = chosen ?? (periods.data ? { preset: "this_year", ...presetRange("this_year", periods.data)! } : null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", "trial-balance", range?.from, range?.to, showZero),
    queryFn: () => trialBalance({ from: range!.from, to: range!.to, showZero: showZero ? "true" : undefined }), enabled: Boolean(range?.from && range?.to), placeholderData: (previous) => previous,
  });
  if (errorStatus(periods.error) === 403 || errorStatus(query.error) === 403) return <NoAccess />;
  if (periods.isLoading || !range) return <LoadingState label="Loading the trial balance" rows={10} />;
  const tb = query.data;
  const exportCsv = () => tb && downloadCsv(`trial-balance-${tb.from}-to-${tb.to}.csv`, [
    ["Code", "Account", "Opening debit", "Opening credit", "Debit", "Credit", "Closing debit", "Closing credit"],
    ...tb.rows.map((row) => [row.code, row.name, row.openingDebit, row.openingCredit, row.debit, row.credit, row.closingDebit, row.closingCredit]),
    ["", "Total", tb.totals.openingDebit, tb.totals.openingCredit, tb.totals.debit, tb.totals.credit, tb.totals.closingDebit, tb.totals.closingCredit],
  ]);
  return (
    <StatementPage title="Trial Balance" description="Every account's balance before the period, its debits and credits in the period, and its balance at the end. Each pair of columns must agree."
      subtitle={tb ? periodText(tb.from, tb.to) : ""} onExport={tb ? exportCsv : undefined}
      controls={<div className="flex flex-wrap items-end justify-between gap-3"><PeriodControls range={range} onChange={setChosen} periods={periods.data} />
        <Checkbox isSelected={showZero} onChange={setShowZero}>Show accounts with no balance</Checkbox></div>}
      check={tb ? { balanced: tb.balanced, exceptions: tb.exceptions, ok: "Balanced: opening, period and closing debits each equal their credits." } : undefined}>
      {query.isLoading ? <LoadingState label="Loading the trial balance" rows={10} /> : query.isError || !tb ? <ErrorState title="Could not load the trial balance" description={errorMessage(query.error)} /> : (
        <LinesTable columns={["Account", { label: "Opening Dr", numeric: true }, { label: "Opening Cr", numeric: true }, { label: "Debit", numeric: true }, { label: "Credit", numeric: true },
          { label: "Closing Dr", numeric: true }, { label: "Closing Cr", numeric: true }]} empty={tb.rows.length ? undefined : "Nothing was posted up to this date."}>
          {tb.rows.map((row) => (
            <tr key={row.accountId}>
              <Cell><span className="whitespace-nowrap"><AccountLink accountId={row.accountId} code={row.code} name={row.name} from={tb.from} to={tb.to} /></span></Cell>
              <Cell numeric><Money value={row.openingDebit} /></Cell><Cell numeric><Money value={row.openingCredit} /></Cell>
              <Cell numeric><Money value={row.debit} /></Cell><Cell numeric><Money value={row.credit} /></Cell>
              <Cell numeric><Money value={row.closingDebit} strong /></Cell><Cell numeric><Money value={row.closingCredit} strong /></Cell>
            </tr>
          ))}
          {tb.rows.length > 0 && (
            <tr className="bg-surface-muted font-semibold">
              <Cell>Total</Cell>
              <Cell numeric><Money value={tb.totals.openingDebit} strong /></Cell><Cell numeric><Money value={tb.totals.openingCredit} strong /></Cell>
              <Cell numeric><Money value={tb.totals.debit} strong /></Cell><Cell numeric><Money value={tb.totals.credit} strong /></Cell>
              <Cell numeric><Money value={tb.totals.closingDebit} strong /></Cell><Cell numeric><Money value={tb.totals.closingCredit} strong /></Cell>
            </tr>
          )}
        </LinesTable>
      )}
    </StatementPage>
  );
}
