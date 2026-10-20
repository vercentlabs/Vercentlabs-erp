"use client";

// Cash flow (indirect method): net profit, the non-cash items and working-capital changes that turn it into operating cash, then investing
// and financing — reconciled to the cash and bank balances at both ends. Money moved between the company's own accounts is not a flow.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { cashFlow, downloadCsv, errorMessage, errorStatus, type CashFlowItem } from "../api/statements-api";
import { AccountLink, Money, NoAccess, PeriodControls, StatementPage, periodText, presetRange, usePeriods, type Range } from "../components/StatementKit";

export function CashFlowScreen() {
  const workspace = useWorkspaceContext();
  const periods = usePeriods();
  const [chosen, setChosen] = useState<Range | null>(null);
  const range = chosen ?? (periods.data ? { preset: "this_year", ...presetRange("this_year", periods.data)! } : null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", "cash-flow", range?.from, range?.to),
    queryFn: () => cashFlow({ from: range!.from, to: range!.to }), enabled: Boolean(range?.from && range?.to), placeholderData: (previous) => previous,
  });
  if (errorStatus(periods.error) === 403 || errorStatus(query.error) === 403) return <NoAccess />;
  if (periods.isLoading || !range) return <LoadingState label="Loading the cash flow" rows={10} />;
  const cf = query.data;
  const exportCsv = () => cf && downloadCsv(`cash-flow-${cf.from}-to-${cf.to}.csv`, [
    ["Line", "Amount"], ["Net profit", cf.operating.netProfit], ...cf.operating.items.map((item) => [item.label, item.amount]), ["Cash from operating activities", cf.operating.total],
    ...cf.investing.items.map((item) => [item.label, item.amount]), ["Cash from investing activities", cf.investing.total],
    ...cf.financing.items.map((item) => [item.label, item.amount]), ["Cash from financing activities", cf.financing.total],
    ["Net change in cash", cf.netChange], ["Cash at the start", cf.openingCash], ["Cash at the end", cf.closingCash],
  ]);
  return (
    <StatementPage title="Cash Flow" description="Where cash came from and went, by operating, investing and financing activity (indirect method). It must reconcile to the cash and bank balances."
      subtitle={cf ? periodText(cf.from, cf.to) : ""} onExport={cf ? exportCsv : undefined}
      controls={<PeriodControls range={range} onChange={setChosen} periods={periods.data} />}
      check={cf ? { balanced: cf.balanced, exceptions: cf.exceptions, ok: "Reconciled: cash at the start plus the net change equals cash at the end." } : undefined}>
      {query.isLoading ? <LoadingState label="Loading the cash flow" rows={10} /> : query.isError || !cf ? <ErrorState title="Could not load the cash flow" description={errorMessage(query.error)} /> : (
        <div className="flex flex-col gap-4">
          <LinesTable columns={["", { label: periodText(cf.from, cf.to), numeric: true }]}>
            <Section label="Operating activities" />
            <tr><Cell className="pl-6">Net profit</Cell><Cell numeric><Money value={cf.operating.netProfit} /></Cell></tr>
            <Items items={cf.operating.items} />
            <Total label="Cash from operating activities" value={cf.operating.total} />
            <Section label="Investing activities" />
            <Items items={cf.investing.items} empty="No fixed assets bought or sold" />
            <Total label="Cash from investing activities" value={cf.investing.total} />
            <Section label="Financing activities" />
            <Items items={cf.financing.items} empty="No borrowing or capital movements" />
            <Total label="Cash from financing activities" value={cf.financing.total} />
            <tr className="border-t-2 border-border-strong bg-surface-muted"><Cell className="text-base font-bold text-text">Net change in cash</Cell><Cell numeric><Money value={cf.netChange} strong className="text-base" /></Cell></tr>
            <tr><Cell>Cash at the start</Cell><Cell numeric><Money value={cf.openingCash} /></Cell></tr>
            <tr><Cell className="font-semibold text-text">Cash at the end</Cell><Cell numeric><Money value={cf.closingCash} strong /></Cell></tr>
          </LinesTable>
          <Panel title="Cash and bank accounts" description="The accounts counted as cash: cash, bank, and funds in transit between them.">
            <LinesTable columns={["Account", { label: "At the start", numeric: true }, { label: "At the end", numeric: true }]} empty={cf.cashAccounts.length ? undefined : "No cash or bank balance."}>
              {cf.cashAccounts.map((row) => (
                <tr key={row.accountId}><Cell><AccountLink accountId={row.accountId} code={row.code} name={row.name} from={cf.from} to={cf.to} /></Cell>
                  <Cell numeric><Money value={row.opening} /></Cell><Cell numeric><Money value={row.closing} /></Cell></tr>
              ))}
            </LinesTable>
          </Panel>
        </div>
      )}
    </StatementPage>
  );
}

function Section({ label }: { label: string }) {
  return <tr className="bg-surface-muted/60"><Cell className="font-semibold text-text">{label}</Cell><Cell numeric>{" "}</Cell></tr>;
}
function Items({ items, empty }: { items: CashFlowItem[]; empty?: string }) {
  if (!items.length) return empty ? <tr><Cell className="pl-6 text-text-muted">{empty}</Cell><Cell numeric><Money value={0} /></Cell></tr> : null;
  return <>{items.map((item) => <tr key={item.key}><Cell className="pl-6">{item.label}</Cell><Cell numeric><Money value={item.amount} /></Cell></tr>)}</>;
}
function Total({ label, value }: { label: string; value: number }) {
  return <tr className="border-t-2 border-border-strong"><Cell className="font-semibold text-text">{label}</Cell><Cell numeric><Money value={value} strong /></Cell></tr>;
}
