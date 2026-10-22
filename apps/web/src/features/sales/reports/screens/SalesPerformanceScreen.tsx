"use client";

// Sales › Reports › Salesperson Performance (Sales audit): per salesperson for a month — the target, what was invoiced (posted invoices less
// credit notes, in the company's currency, by the salesperson who owns the order), achievement, orders confirmed, margin (to those who may
// see it) and commission. A salesperson sees their own row; whoever sees every order sees everyone. Targets are set here.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, ErrorState, LinkButton, NumberField, PageHeader, ProgressBar, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { post, request, SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";

type Row = { userId: string; name: string; target: number | null; invoiced: number; achievementPercent: number | null; invoices: number; orders: number; commission: number;
  margin?: number; marginPercent?: number | null };
type Performance = { month: string; currencyCode: string; showsMargin: boolean; canSetTargets: boolean; rows: Row[] };

export function SalesPerformanceScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7));
  const key = scopedQueryKey(workspace, "sales", "performance", month);
  const query = useQuery({ queryKey: key, queryFn: () => request<{ performance: Performance }>(`/performance?month=${month}`).then((r) => r.performance) });
  const [editing, setEditing] = useState<Row | null>(null);
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Salespeople & Targets" description="Each salesperson's monthly target of invoiced value and what they achieved, in the company's currency, with orders, margin and commission."
        secondaryActions={<div className="flex flex-wrap gap-2"><LinkButton variant="secondary" href="/settings/teams">Sales teams</LinkButton>
          <LinkButton variant="secondary" href="/sales/settings/commissions">Commission rules</LinkButton><LinkButton variant="secondary" href="/sales/beats">Beats</LinkButton></div>} />
      <div className="flex items-end gap-3"><TextField label="Month" type="month" value={month} onChange={(value) => value && setMonth(value)} /></div>
      {query.isLoading && <LoadingState label="Loading performance" rows={5} />}
      {query.isError && <ErrorState title="Could not load performance" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
      {data && (data.rows.length === 0 ? <p className="text-sm text-text-muted">No salesperson has orders or a target yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="py-2 pr-3 font-medium">Salesperson</th><th className="py-2 pr-3 text-right font-medium">Target</th><th className="py-2 pr-3 text-right font-medium">Invoiced</th>
                <th className="py-2 pr-3 font-medium">Achieved</th><th className="py-2 pr-3 text-right font-medium">Orders</th>
                {data.showsMargin && <th className="py-2 pr-3 text-right font-medium">Margin</th>}<th className="py-2 pr-3 text-right font-medium">Commission</th><th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.userId} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-medium">{row.name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.target === null ? "—" : money(data.currencyCode, row.target)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(data.currencyCode, row.invoiced)}</td>
                  <td className="py-2 pr-3">{row.achievementPercent === null ? "—" : <ProgressBar label={`${row.achievementPercent}%`} value={Math.min(100, row.achievementPercent)} />}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.orders}</td>
                  {data.showsMargin && <td className="py-2 pr-3 text-right tabular-nums">{money(data.currencyCode, row.margin ?? 0)}{row.marginPercent != null ? ` (${row.marginPercent}%)` : ""}</td>}
                  <td className="py-2 pr-3 text-right tabular-nums">{money(data.currencyCode, row.commission)}</td>
                  <td className="py-2 text-right">{data.canSetTargets && <Button variant="ghost" size="compact" onPress={() => setEditing(row)}>Set target</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {editing && data && (
        <TargetDialog row={editing} month={month} currencyCode={data.currencyCode} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: key }); }} />
      )}
    </div>
  );
}

function TargetDialog({ row, month, currencyCode, onClose, onSaved }: { row: Row; month: string; currencyCode: string; onClose: () => void; onSaved: () => void }) {
  const [target, setTarget] = useState(row.target ?? NaN);
  const save = useMutation({ mutationFn: () => post("/performance/targets", { userId: row.userId, month, target: Number.isFinite(target) ? target : 0 }), onSuccess: onSaved });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Target for ${row.name}`} description={`Invoiced value for ${month}, in ${currencyCode}. Empty or 0 clears it.`} size="sm">
      <div className="flex flex-col gap-4">
        {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof SalesApiError ? save.error.message : "The target could not be saved."}</p>}
        <NumberField label={`Target (${currencyCode})`} value={target} onChange={setTarget} minValue={0} step={1000} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
