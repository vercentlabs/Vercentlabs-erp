"use client";

// Repeat on a schedule (Sales report Phase 3): on an order's page, set it to repeat every 1, 3, 6 or 12 months on a day of the month —
// making a confirmed order each time, or a final invoice that can be emailed — and Pause, Resume or End it. The last runs are listed,
// with what each made or why it could not.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, NumberField, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { calendarDate } from "@/features/sales/shared/format";
import { post, request } from "@/features/sales/shared/http";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export type RecurringSchedule = { id: string; orderId: string; intervalMonths: 1 | 3 | 6 | 12; intervalLabel: string; dayOfMonth: number; startDate: string; endDate: string | null;
  nextRunDate: string | null; makes: "order" | "invoice"; autoSend: boolean; status: "active" | "paused" | "ended"; runs: number; lastRunDate: string | null; lastError: string | null;
  orderNumber?: string; customerName?: string | null; grandTotal?: number };
type Run = { runDate: string; orderId: string | null; orderNumber: string | null; invoiceId: string | null; invoiceNumber: string | null; error: string | null };

export const scheduleTone = (status: RecurringSchedule["status"]) => (status === "active" ? "success" : status === "paused" ? "warning" : "neutral");
export const scheduleStatus = (status: RecurringSchedule["status"]) => (status === "active" ? "Running" : status === "paused" ? "Paused" : "Ended");
export const scheduleSummary = (schedule: RecurringSchedule) =>
  `${schedule.intervalLabel} on day ${schedule.dayOfMonth} · ${schedule.makes === "invoice" ? `a final invoice${schedule.autoSend ? ", emailed" : ""}` : "a confirmed order"}`;

export function RecurringPanel({ orderId, canEdit }: { orderId: string; canEdit: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "recurring", orderId);
  const query = useQuery({ queryKey: key, queryFn: () => request<{ schedule: RecurringSchedule | null; runs: Run[] }>(`/orders/${orderId}/recurring`) });
  const [editing, setEditing] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "recurring") });
  const status = useMutation({ mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "end" }) => post(`/recurring/${id}`, { action }), onSuccess: refresh });
  const schedule = query.data?.schedule ?? null;
  const open = schedule && schedule.status !== "ended" ? schedule : null;
  const runs = query.data?.runs ?? [];
  const actions = open && canEdit ? [
    { id: "edit", label: "Change schedule", run: () => setEditing(true) },
    open.status === "active" ? { id: "pause", label: "Pause", run: () => status.mutate({ id: open.id, action: "pause" }) }
      : { id: "resume", label: "Resume", run: () => status.mutate({ id: open.id, action: "resume" }) },
    { id: "end", label: "End", run: () => status.mutate({ id: open.id, action: "end" }) },
  ] : [];
  return (
    <Panel title="Repeat on a schedule" description="A new order like this one each month or quarter, priced on the day."
      actions={!open && canEdit ? <Button variant="secondary" size="compact" onPress={() => setEditing(true)}>Set up</Button> : actions.length ? (
        <>
          <div className="sm:hidden"><MoreMenu label="Schedule actions" items={actions.map((action) => ({ id: action.id, label: action.label, onAction: action.run }))} /></div>
          <div className="hidden flex-wrap gap-1 sm:flex">
            {actions.map((action) => <Button key={action.id} variant="ghost" size="compact" isDisabled={status.isPending} onPress={action.run}>{action.label}</Button>)}
          </div>
        </>
      ) : undefined}>
      {status.isError && <Notice tone="danger">{(status.error as Error).message}</Notice>}
      {query.isLoading ? <p className="text-sm text-text-muted">Loading…</p> : !open ? (
        <p className="text-sm text-text-secondary">{schedule ? `The schedule ended after ${schedule.runs} ${schedule.runs === 1 ? "repeat" : "repeats"}.` : "Not repeating."}</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <span className="flex flex-wrap items-center gap-2"><StatusBadge tone={scheduleTone(open.status)}>{scheduleStatus(open.status)}</StatusBadge>{scheduleSummary(open)}</span>
          <span className="text-text-secondary">
            {open.status === "active" && open.nextRunDate ? `Next on ${calendarDate(open.nextRunDate)}` : "Paused: no repeats until resumed"}
            {open.endDate ? ` · until ${calendarDate(open.endDate)}` : ""}
          </span>
          {open.lastError && <Notice tone="warning">{`Last time: ${open.lastError}`}</Notice>}
        </div>
      )}
      {runs.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-border border-t border-border text-sm">
          {runs.map((run) => (
            <li key={run.runDate} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="text-text-secondary">{calendarDate(run.runDate)}</span>
              <span className="flex flex-wrap gap-x-3">
                {run.orderId && <Link className="text-accent hover:underline" href={`/sales/orders/${run.orderId}`}>{run.orderNumber ?? "Order"}</Link>}
                {run.invoiceId && <Link className="text-accent hover:underline" href={`/sales/invoices/${run.invoiceId}`}>{run.invoiceNumber ?? "Invoice"}</Link>}
                {run.error && <span className="text-danger">{run.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && <ScheduleDialog orderId={orderId} schedule={open} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />}
    </Panel>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function ScheduleDialog({ orderId, schedule, onClose, onSaved }: { orderId: string; schedule: RecurringSchedule | null; onClose: () => void; onSaved: () => void }) {
  const [intervalMonths, setIntervalMonths] = useState<1 | 3 | 6 | 12>(schedule?.intervalMonths ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(schedule?.dayOfMonth ?? Math.min(new Date().getDate(), 28));
  const [startDate, setStartDate] = useState(schedule?.startDate ?? today());
  const [endDate, setEndDate] = useState(schedule?.endDate ?? "");
  const [makes, setMakes] = useState<"order" | "invoice">(schedule?.makes ?? "order");
  const [autoSend, setAutoSend] = useState(schedule?.autoSend ?? false);
  const save = useMutation({
    mutationFn: () => request(`/orders/${orderId}/recurring`, { method: "PUT", body: JSON.stringify({ intervalMonths, dayOfMonth, startDate, endDate: endDate || null, makes,
      autoSend: makes === "invoice" && autoSend }) }),
    onSuccess: onSaved,
  });
  const ready = Boolean(startDate) && dayOfMonth >= 1 && dayOfMonth <= 28 && (!endDate || endDate >= startDate);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} size="md" title={schedule ? "Change the schedule" : "Repeat this order"}
      description="Each repeat copies this order's customer, products and quantities, at the prices on the day.">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="How often" selectedKey={String(intervalMonths)} onSelectionChange={(key) => setIntervalMonths(Number(key) === 3 ? 3 : Number(key) === 6 ? 6 : Number(key) === 12 ? 12 : 1)}
            options={[{ value: "1", label: "Every month" }, { value: "3", label: "Every 3 months" }, { value: "6", label: "Every 6 months" }, { value: "12", label: "Every year" }]} />
          <NumberField label="On day" value={dayOfMonth} onChange={(value) => setDayOfMonth(Number.isFinite(value) ? Math.trunc(value) : 1)} minValue={1} maxValue={28} step={1}
            description="1 to 28, so every month has it." />
          <TextField label="Starting" type="date" isRequired value={startDate} onChange={setStartDate} />
          <TextField label="Until (optional)" type="date" value={endDate} onChange={setEndDate} />
          <div className="sm:col-span-2">
            <Select label="Each time, make" selectedKey={makes} onSelectionChange={(key) => setMakes(key === "invoice" ? "invoice" : "order")}
              options={[{ value: "order", label: "A confirmed order" }, { value: "invoice", label: "A confirmed order and its final invoice" }]} />
          </div>
        </div>
        {makes === "invoice" && <Checkbox isSelected={autoSend} onChange={setAutoSend}>Email the invoice to the order&apos;s contact</Checkbox>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!ready}>{schedule ? "Save schedule" : "Start repeating"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
