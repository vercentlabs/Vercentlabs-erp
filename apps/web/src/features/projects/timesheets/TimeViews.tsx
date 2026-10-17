"use client";

// Projects — Timesheets, the shared pieces: the week's hours by day, a table of entries (with their flags, review state and — for those who
// may see it — billing), submitting a week, and asking for a correction of approved time.
import { useState } from "react";
import { Button, Checkbox, Dialog, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { Notice } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";

import { errorMessage, newKey } from "../api/projects-api";
import { requestClassificationCorrection } from "../billable/billable-api";
import { ENTRY_TONE, hours, requestCorrection, runTimeCommand, submitWeek, type TimeEntry, type Week } from "./timesheets-api";

const REASONS = [["INTERNAL_WORK", "Internal work"], ["INCLUDED_IN_CONTRACT", "Included in the contract"], ["INTERNAL_MEETING", "Internal meeting"], ["TRAINING", "Training"],
  ["REWORK_INTERNAL", "Internal rework"], ["GOODWILL_SUPPORT", "Goodwill support"], ["NON_BILLABLE_CONTRACT", "Excluded by the contract"]].map(([value, label]) => ({ value, label }));

// Hours by day, as bars against the busiest day (or the review threshold).
export function WeekBars({ week, onDay, selected }: { week: Week; onDay?: (date: string) => void; selected?: string | null }) {
  const top = Math.max(week.policy.dailyReviewMinutes, ...week.days.map((day) => day.minutes), 60);
  return (
    <div className="grid grid-cols-7 gap-2" role="list" aria-label="Hours by day">
      {week.days.map((day) => (
        <button key={day.date} type="button" role="listitem" onClick={() => onDay?.(day.date)} disabled={!onDay}
          className={`flex flex-col items-center gap-1 rounded-md border p-2 text-xs ${selected === day.date ? "border-brand" : "border-border"} ${day.future ? "opacity-60" : ""}`}
          aria-label={`${day.weekday} ${day.date}: ${day.minutes ? day.total : "no time"}`}>
          <span className="flex h-24 w-full items-end justify-center">
            <span className={`w-6 rounded-t ${day.overReview ? "bg-warning" : "bg-brand"}`} style={{ height: `${Math.round((day.minutes / top) * 100)}%`, minHeight: day.minutes ? 4 : 0 }} />
          </span>
          <span className="font-medium">{day.weekday}</span>
          <span className="text-text-muted">{day.minutes ? day.total : "—"}</span>
        </button>
      ))}
    </div>
  );
}

export function FlagList({ entry }: { entry: TimeEntry }) {
  const flags = entry.flags.filter((flag) => flag.code !== "DELEGATED");
  if (!flags.length && !entry.enteredBy) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {entry.enteredBy && <StatusBadge tone="neutral">{`Recorded by ${entry.enteredBy}`}</StatusBadge>}
      {flags.map((flag) => <StatusBadge key={flag.code} tone="warning">{flag.label}</StatusBadge>)}
    </span>
  );
}

type EntryActions = { onEdit?: (entry: TimeEntry) => void; onRemove?: (entry: TimeEntry) => void; onCorrect?: (entry: TimeEntry) => void };
export function EntryTable({ entries, showEmployee = false, showDate = true, empty = "No time recorded.", ...actions }: { entries: TimeEntry[]; showEmployee?: boolean; showDate?: boolean; empty?: string } & EntryActions) {
  return (
    <LinesTable empty={empty} columns={[...(showDate ? ["Date"] : []), ...(showEmployee ? ["Employee"] : []), "Project / task", "Work", { label: "Duration", numeric: true }, "Billable", "Status", ""]}>
      {entries.map((entry) => (
        <tr key={entry.id} className={entry.status === "VOIDED" ? "opacity-60" : undefined}>
          {showDate && <Cell><span className="flex flex-col"><span>{`${entry.weekday} ${entry.workDate}`}</span>{entry.startTime && <span className="text-xs text-text-muted">{`${entry.startTime}–${entry.endTime}`}</span>}</span></Cell>}
          {showEmployee && <Cell>{entry.employee ?? "—"}</Cell>}
          <Cell><span className="flex min-w-0 flex-col"><span>{entry.projectCode}</span><span className="truncate text-xs text-text-muted">{entry.task ?? "Project-level work"}</span></span></Cell>
          <Cell><span className="flex min-w-0 flex-col gap-1"><span className="line-clamp-2">{entry.description}</span><FlagList entry={entry} />
            {entry.voidReason && <span className="text-xs text-text-muted">{entry.voidReason}</span>}</span></Cell>
          <Cell numeric>{entry.duration}</Cell>
          <Cell><span className="flex flex-col"><span>{entry.billing.label ?? entry.classificationLabel}</span>{entry.reason && <span className="text-xs text-text-muted">{entry.reason}</span>}</span></Cell>
          <Cell><StatusBadge tone={ENTRY_TONE[entry.status]}>{entry.statusLabel}</StatusBadge></Cell>
          <Cell>
            <span className="flex justify-end gap-1">
              {entry.can.edit && actions.onEdit && <Button size="compact" variant="ghost" onPress={() => actions.onEdit!(entry)}>Edit</Button>}
              {entry.can.remove && actions.onRemove && <Button size="compact" variant="ghost" onPress={() => actions.onRemove!(entry)}>Remove</Button>}
              {entry.can.correct && actions.onCorrect && <Button size="compact" variant="ghost" onPress={() => actions.onCorrect!(entry)}>Request correction</Button>}
            </span>
          </Cell>
        </tr>
      ))}
    </LinesTable>
  );
}

// Submit the week: by project, with the reason when it is late. Nothing is told as submitted until the server confirms it.
export function SubmitWeekDialog({ week, onClose, onDone }: { week: Week; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const pending = week.projects.filter((row) => row.unsubmittedMinutes > 0);
  const [chosen, setChosen] = useState<string[]>(pending.map((row) => row.projectId));
  const [lateReason, setLateReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const { run } = useSubmitKey();
  const total = pending.filter((row) => chosen.includes(row.projectId)).reduce((sum, row) => sum + row.unsubmittedMinutes, 0);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await runTimeCommand(key, () => run(() => submitWeek({ weekStart: week.weekStart, projectIds: chosen, lateReason: lateReason || undefined, idempotencyKey: key })));
      await onDone(`Submitted ${hours(total)} for review.`);
      onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Submit the week of ${week.weekStart}`}
      description="Each project's time goes to its manager for review. Submitted time is locked until it is approved or returned.">
      <div className="flex flex-col gap-3">
        {pending.map((row) => (
          <Checkbox key={row.projectId} isSelected={chosen.includes(row.projectId)} onChange={(on) => setChosen(on ? [...chosen, row.projectId] : chosen.filter((id) => id !== row.projectId))}>
            {`${row.project} — ${hours(row.unsubmittedMinutes)}`}
          </Checkbox>
        ))}
        {week.late && <TextArea label="Why is it late?" value={lateReason} onChange={setLateReason} isRequired description={`This week was due by ${week.deadline}.`} />}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !chosen.length || (week.late && lateReason.trim().length < 3)} onPress={submit}>{`Submit ${hours(total)}`}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// Approved time is never edited: ask for a correction with the right values (or to void it) and the reason; someone else decides.
export function CorrectionDialog({ entry, onClose, onDone }: { entry: TimeEntry; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [kind, setKind] = useState<"ADJUST" | "VOID" | "SPLIT">("ADJUST");
  const [reasonCode, setReasonCode] = useState<string | null>(entry.reasonCode);
  const [splitHours, setSplitHours] = useState("");
  const [h, setH] = useState(String(Math.floor(entry.durationMinutes / 60)));
  const [m, setM] = useState(String(entry.durationMinutes % 60));
  const [workDate, setWorkDate] = useState(entry.workDate);
  const [billable, setBillable] = useState(entry.billable);
  const [words, setWords] = useState(entry.description);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const minutes = (Number(h || 0) * 60) + Number(m || 0);
      const split = Math.round(Number(splitHours || 0) * 60);
      const result = kind === "SPLIT"
        ? await runTimeCommand(key, () => requestClassificationCorrection(entry.id, { reason, idempotencyKey: key, parts: [{ durationMinutes: entry.durationMinutes - split },
          { durationMinutes: split, billable: false, billingReasonCode: reasonCode ?? "INTERNAL_WORK" }] }))
        : await runTimeCommand(key, () => requestCorrection(entry.id, { ...(kind === "VOID" ? { kind, reason } : { kind, reason, workDate, billable, description: words,
          billingReasonCode: billable ? undefined : reasonCode ?? undefined, ...(entry.startTime ? {} : { durationMinutes: minutes }) }), idempotencyKey: key }));
      await onDone("billingAdjustmentRequired" in result && result.billingAdjustmentRequired
        ? `Correction requested. ${hours(result.billedMinutes)} of this time is billed: Sales's adjustment is needed before it is applied.` : "Correction requested: a reviewer decides it.");
      onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Correct ${entry.number}`}
      description={`Approved ${entry.duration} on ${entry.workDate}. The original stays in the history; the correction is appended once someone authorized approves it.`}>
      <div className="flex flex-col gap-3">
        <Select label="Correction" selectedKey={kind} onSelectionChange={(value) => setKind(String(value) as "ADJUST" | "VOID" | "SPLIT")}
          options={[{ value: "ADJUST", label: "Correct the values (or the billing classification)" }, ...(entry.billable && !entry.startTime ? [{ value: "SPLIT", label: "Split off non-billable time" }] : []),
            { value: "VOID", label: "Void this time (it should not have been recorded)" }]} />
        {kind === "SPLIT" && (
          <div className="grid grid-cols-2 gap-3">
            <TextField label={`Non-billable hours (of ${entry.duration})`} inputMode="decimal" value={splitHours} onChange={setSplitHours} />
            <Select label="Reason" selectedKey={reasonCode} onSelectionChange={(value) => setReasonCode(value ? String(value) : null)} options={REASONS} />
          </div>
        )}
        {kind === "ADJUST" && (
          <>
            {!entry.startTime && <div className="grid grid-cols-2 gap-3"><TextField label="Hours" inputMode="numeric" value={h} onChange={setH} /><TextField label="Minutes" inputMode="numeric" value={m} onChange={setM} /></div>}
            <TextField label="Work date" type="date" value={workDate} onChange={setWorkDate} />
            <TextArea label="Work" value={words} onChange={setWords} />
            <Checkbox isSelected={billable} onChange={setBillable}>Billable to customer</Checkbox>
            {!billable && <Select label="Non-billable reason" selectedKey={reasonCode} onSelectionChange={(value) => setReasonCode(value ? String(value) : null)} options={REASONS} />}
          </>
        )}
        <TextArea label="Why is it corrected?" value={reason} onChange={setReason} isRequired />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || reason.trim().length < 3} onPress={submit}>Request correction</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function RemoveEntryDialog({ entry, onClose, onConfirm }: { entry: TimeEntry; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Remove ${entry.number}`}
      description={entry.status === "CHANGES_REQUESTED" ? "It was submitted once: it is withdrawn and kept in the history." : `${entry.duration} on ${entry.workDate} is removed; the removal stays in the history.`}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="danger" isLoading={busy} isDisabled={busy} onPress={async () => { setBusy(true); setError(null); try { await onConfirm(); onClose(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }}>Remove</Button>
        </div>
      </div>
    </Dialog>
  );
}
