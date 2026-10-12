"use client";

// Day-End: pick the outlet, close its business day (today's, or an earlier day still open), and find past Z reports. Managers set the outlet's
// business-day cut-off here; it applies to days not yet started.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { dayEndContext, setCutoff, zReports } from "@/features/pos/day-end/api/day-end-api";
import { DayEndPanel } from "@/features/pos/day-end/components/DayEndPanel";
import { listOutlets } from "@/features/pos/outlets/api/outlets-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function DayEndScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState<string | null>(null);
  const outlets = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "outlets", "day-end"), queryFn: () => listOutlets({}), retry: false });
  const context = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "day-end", storeId, businessDate), queryFn: () => dayEndContext(storeId, businessDate), retry: false });
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "day-end", "history", context.data?.outlet.id), queryFn: () => zReports({ storeId: context.data!.outlet.id, limit: "30" }),
    enabled: Boolean(context.data), retry: false });
  const [cutoff, setCutoffValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (context.isLoading) return <PosLoading label="Loading the business day…" />;
  if (context.isError || !context.data) {
    if (context.error instanceof PosApiError && context.error.status === 403) return <PermissionState title="You cannot view day-end reports" description="Ask an outlet manager for access." />;
    return <PosAlert>{context.error instanceof PosApiError ? context.error.message : "Could not load the business day."}</PosAlert>;
  }
  const data = context.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Day-End / Z Report" description="Review the business day, resolve what blocks it, and finalize its Z report. Selling on the next day is never held up." />
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Outlet" size="compact" selectedKey={data.outlet.id} onSelectionChange={(value) => { setStoreId(String(value)); setBusinessDate(null); }}
          options={(outlets.data?.outlets ?? [{ id: data.outlet.id, name: data.outlet.name, code: data.outlet.code }]).map((outlet) => ({ value: outlet.id, label: `${outlet.name} (${outlet.code})` }))} />
        {data.unclosed.length > 0 && (
          <Select label="Business day" size="compact" selectedKey={businessDate ?? data.day.businessDate} onSelectionChange={(value) => setBusinessDate(String(value))}
            options={[data.day, ...data.unclosed].map((day) => ({ value: day.businessDate, label: `${day.businessDate} · ${day.status.toLowerCase().replace(/_/g, " ")}` }))} />
        )}
      </div>
      {data.unclosed.length > 0 && !businessDate && <PosAlert tone="warning">{data.unclosed.length} earlier business day(s) are not closed yet. Choose one above to close it.</PosAlert>}
      <DayEndPanel key={data.day.id} context={data} day={data.day} />
      <PosPanel title="Z reports" description={`${history.data?.total ?? 0} finalized for ${data.outlet.name}.`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Report</th><th className="pb-1 text-left">Business date</th><th className="pb-1 text-right">Sales</th>
              <th className="pb-1 text-right">Consideration</th><th className="pb-1 text-right">Cash difference</th><th className="pb-1 text-left">Finalized</th><th className="pb-1 text-left">Notes</th></tr></thead>
            <tbody>{(history.data?.rows ?? []).map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-1.5"><Link href={`/pos/day-end/z-reports/${row.id}`} className="font-medium text-brand hover:underline">{row.number}</Link></td>
                <td>{row.businessDate}</td><td className="text-right tabular-nums">{row.sales}</td><td className="text-right tabular-nums">{money(data.outlet.currency, row.consideration)}</td>
                <td className="text-right tabular-nums">{money(data.outlet.currency, row.cashVariance)}</td><td>{dateTime(row.finalizedAt)} · {row.finalizedBy ?? "—"}</td>
                <td className="flex flex-wrap gap-1">{row.tracked > 0 && <StatusBadge tone="info">{`${row.tracked} tracked`}</StatusBadge>}{row.adjustments > 0 && <StatusBadge tone="neutral">{`${row.adjustments} adjustments`}</StatusBadge>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </PosPanel>
      {workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("pos.store.manage") ? (
        <PosPanel title="Business-day cut-off" description={`Currently ${data.outlet.cutoff} (${data.outlet.timezone}). A change applies to business days not yet started; closed days keep their period.`}>
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="New cut-off (HH:MM)" size="compact" value={cutoff} onChange={setCutoffValue} maxLength={5} className="sm:max-w-[10rem]" />
            <Button size="compact" variant="secondary" isDisabled={!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff.trim())}
              onPress={async () => { setError(null); try { await setCutoff(data.outlet.id, cutoff.trim()); setCutoffValue(""); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "day-end") }); } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not save."); } }}>
              Save cut-off
            </Button>
          </div>
          {error && <PosAlert>{error}</PosAlert>}
        </PosPanel>
      ) : null}
    </div>
  );
}
