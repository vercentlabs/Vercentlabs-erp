"use client";

// Sales › Sales Orders › Recurring orders (Sales report Phase 3): every schedule that has not ended — what it makes, how often, the next
// date — with Pause, Resume and End. A schedule is set up on its order's page.
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, StatusBadge } from "@vercentlabs/design-system";

import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { calendarDate, money } from "@/features/sales/shared/format";
import { post, request } from "@/features/sales/shared/http";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scheduleStatus, scheduleSummary, scheduleTone, type RecurringSchedule } from "../components/RecurringPanel";

export function RecurringOrdersScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canEdit = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.order.create");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "recurring", "all"), queryFn: () => request<{ schedules: RecurringSchedule[] }>("/recurring") });
  const status = useMutation({ mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "end" }) => post(`/recurring/${id}`, { action }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "recurring") }) });
  const schedules = query.data?.schedules ?? [];
  const actionsOf = (schedule: RecurringSchedule) => [
    schedule.status === "active" ? { id: "pause", label: "Pause", run: () => status.mutate({ id: schedule.id, action: "pause" }) }
      : { id: "resume", label: "Resume", run: () => status.mutate({ id: schedule.id, action: "resume" }) },
    { id: "end", label: "End", run: () => status.mutate({ id: schedule.id, action: "end" }) },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Recurring orders" description="Orders and invoices that repeat on a schedule. Set one up from an order's page." />
      {status.isError && <Notice tone="danger">{(status.error as Error).message}</Notice>}
      <section aria-labelledby="recurring-list" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <h2 id="recurring-list" className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{`${schedules.length} ${schedules.length === 1 ? "schedule" : "schedules"}`}</h2>
        {query.isLoading ? <div className="p-4"><LoadingState label="Loading" rows={4} /></div>
          : query.isError ? <ErrorState title="Could not load the schedules" action={{ label: "Try again", onPress: () => void query.refetch() }} />
          : schedules.length === 0 ? <p className="px-4 py-6 text-sm text-text-secondary">Nothing repeats yet. Open an order and choose Set up under Repeat on a schedule.</p> : (
            <ul className="flex flex-col divide-y divide-border">
              {schedules.map((schedule) => (
                <li key={schedule.id} className="flex items-start gap-3 px-4 py-3.5">
                  <div className="grid min-w-0 flex-1 gap-1 text-sm md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_9rem] md:items-center md:gap-4">
                    <span className="flex min-w-0 flex-col">
                      <Link className="font-medium text-accent hover:underline" href={`/sales/orders/${schedule.orderId}`}>{schedule.orderNumber}</Link>
                      <span className="truncate text-xs text-text-secondary">{`${schedule.customerName ?? ""}${schedule.grandTotal !== undefined ? ` · ${money("INR", schedule.grandTotal)}` : ""}`}</span>
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2"><StatusBadge tone={scheduleTone(schedule.status)}>{scheduleStatus(schedule.status)}</StatusBadge></span>
                      <span className="text-xs text-text-secondary">{scheduleSummary(schedule)}</span>
                      {schedule.lastError && <span className="text-xs text-danger">{`Last time: ${schedule.lastError}`}</span>}
                    </span>
                    <span className="text-xs text-text-secondary md:text-sm">
                      {schedule.status === "active" && schedule.nextRunDate ? `Next ${calendarDate(schedule.nextRunDate)}` : "Paused"}
                    </span>
                  </div>
                  {canEdit && (
                    <>
                      <div className="shrink-0 sm:hidden">
                        <MoreMenu label={`Actions for ${schedule.orderNumber}`} items={actionsOf(schedule).map((action) => ({ id: action.id, label: action.label, onAction: action.run }))} />
                      </div>
                      <div className="hidden shrink-0 gap-1 sm:flex">
                        {actionsOf(schedule).map((action) => <Button key={action.id} variant="ghost" size="compact" isDisabled={status.isPending} onPress={action.run}>{action.label}</Button>)}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
