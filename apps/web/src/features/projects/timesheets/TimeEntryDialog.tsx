"use client";

// Projects — Timesheets, the time form: log time (or change unsubmitted time) — a searchable project and task, the work date (today by
// default), hours and minutes (or start and end times), what was done, and its billing classification: billable or non-billable as the
// project's policy allows (the server decides — billable time still needs approval and a contract line before it is invoiced), the contract
// line where several apply, and the reason for non-billable time. What the person typed stays when the server refuses; its warnings show.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ComboBox, Dialog, RadioGroup, Radio, Select, Switch, TextArea, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { useDebouncedValue } from "@/shared/ui/list";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, newKey } from "../api/projects-api";
import { createEntry, getTimeOptions, getTimeTasks, hours, updateEntry, type TimeEntry, type Warning } from "./timesheets-api";

type Props = { entry?: TimeEntry | null; date?: string; projectId?: string; onClose: () => void; onSaved: (text: string, warnings: Warning[]) => Promise<void> | void };
const whole = (value: string) => (value.trim() === "" ? 0 : Number(value));

export function TimeEntryDialog({ entry, date, projectId: fixedProject, onClose, onSaved }: Props) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-options"), queryFn: getTimeOptions, staleTime: 60_000 });
  const [projectId, setProjectId] = useState<string | null>(entry?.projectId ?? fixedProject ?? null);
  const [taskId, setTaskId] = useState<string | null>(entry?.taskId ?? null);
  const [taskSearch, setTaskSearch] = useState(entry?.task ?? "");
  const term = useDebouncedValue(taskSearch);
  const [workDate, setWorkDate] = useState(entry?.workDate ?? date ?? "");
  const [h, setH] = useState(entry ? String(Math.floor(entry.durationMinutes / 60)) : "");
  const [m, setM] = useState(entry ? String(entry.durationMinutes % 60) : "");
  const [timed, setTimed] = useState(Boolean(entry?.startTime));
  const [start, setStart] = useState(entry?.startTime ?? "");
  const [end, setEnd] = useState(entry?.endTime ?? "");
  const [words, setWords] = useState(entry?.description ?? "");
  const [billable, setBillable] = useState<boolean | null>(entry ? entry.billable : null);
  const [lineId, setLineId] = useState<string | null>(entry?.contractLineId ?? null);
  const [reasonCode, setReasonCode] = useState<string | null>(entry?.reasonCode ?? null);
  const [reasonNote, setReasonNote] = useState(entry?.reasonNote ?? "");
  const [classificationReason, setClassificationReason] = useState("");
  const [employee, setEmployee] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const { run } = useSubmitKey();
  const project = options.data?.projects.find((row) => row.id === projectId) ?? null;
  const tasks = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-tasks", projectId, term), queryFn: () => getTimeTasks(projectId!, term || undefined), enabled: Boolean(projectId) });
  const isBillable = billable ?? project?.defaultBillable ?? false;
  const minutes = timed ? null : whole(h) * 60 + whole(m);
  const shown = useMemo(() => {
    if (!timed || !/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end)) return minutes ? hours(minutes) : null;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const span = (eh * 60 + em) - (sh * 60 + sm);
    return span === 0 ? null : `${hours(span < 0 ? span + 1440 : span)}${span < 0 ? " (ends the next day)" : ""}`;
  }, [timed, start, end, minutes]);
  const save = async () => {
    setBusy(true); setError(null);
    const input = { projectId: projectId ?? undefined, taskId, workDate: workDate || undefined, description: words, billable: isBillable,
      contractLineId: isBillable && lineId ? lineId : undefined, billingReasonCode: isBillable ? null : reasonCode, billingReasonNote: isBillable ? null : reasonNote || null,
      classificationReason: classificationReason || undefined,
      ...(timed ? { startTime: start || undefined, endTime: end || undefined, durationMinutes: undefined } : { durationMinutes: minutes ?? 0, startTime: null, endTime: null }),
      ...(employee && !entry ? { employeeUserId: employee } : {}) };
    try {
      const result = entry ? await run(() => updateEntry(entry.id, { ...input, expectedVersion: entry.version })) : await run(() => createEntry({ ...input, idempotencyKey: key }));
      await onSaved(`${entry ? `Saved: ${hours(result.durationMinutes)}` : `Recorded ${hours(result.durationMinutes)}${project ? ` on ${project.code}` : ""}`}. ${result.explanation ?? ""}`.trim(), result.warnings ?? []);
      onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const valid = Boolean(projectId) && words.trim().length >= 3 && (timed ? Boolean(start && end) : (minutes ?? 0) > 0);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={entry ? `Edit ${entry.number}` : "Log project time"}
      description="Record the time you actually worked. The work date decides whether the project was running, not today's status.">
      <div className="flex flex-col gap-3">
        <ComboBox label="Project" placeholder="Search your projects" isRequired selectedKey={projectId} isDisabled={Boolean(fixedProject) && !entry}
          onSelectionChange={(value) => { setProjectId(value ? String(value) : null); setTaskId(null); setTaskSearch(""); setBillable(null); setEmployee(null); }}
          options={(options.data?.projects ?? []).map((row) => ({ value: row.id, label: row.label }))} isLoading={options.isLoading} emptyMessage="You are not on any project's team." />
        {project && <p className="text-xs text-text-muted">{`${project.billingMethodLabel}${project.billableNote ? ` — ${project.billableNote}` : ""}`}</p>}
        <ComboBox label="Task (optional)" placeholder="Project-level work, or search a task" selectedKey={taskId} inputValue={taskSearch} onInputChange={setTaskSearch} isDisabled={!projectId}
          onSelectionChange={(value) => { setTaskId(value ? String(value) : null); const row = tasks.data?.tasks.find((item) => item.id === value); if (row) setTaskSearch(row.label); }}
          options={(tasks.data?.tasks ?? []).map((row) => ({ value: row.id, label: `${row.label}${row.mine ? " (yours)" : ""}${row.status === "CANCELLED" ? " — cancelled" : ""}` }))}
          isLoading={tasks.isFetching} emptyMessage="No task matches." />
        {!entry && project?.teamLead && (tasks.data?.team.length ?? 0) > 0 && (
          <ComboBox label="Recorded for (optional)" placeholder="Yourself" selectedKey={employee} onSelectionChange={(value) => setEmployee(value ? String(value) : null)}
            description="A project manager may record a team member's time; they are told, and someone else approves it."
            options={(tasks.data?.team ?? []).map((row) => ({ value: row.userId, label: row.name ?? "Team member" }))} />
        )}
        <TextField label="Work date" type="date" value={workDate} onChange={setWorkDate} description="Today if left empty." />
        <Switch isSelected={timed} onChange={setTimed}>Record start and end times</Switch>
        {timed ? (
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Start" type="time" value={start} onChange={setStart} isRequired />
            <TextField label="End" type="time" value={end} onChange={setEnd} isRequired description="Earlier than the start means the next day." />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Hours" inputMode="numeric" value={h} onChange={setH} />
            <TextField label="Minutes" inputMode="numeric" value={m} onChange={setM}
              description={options.data && options.data.incrementMinutes > 1 ? `In steps of ${options.data.incrementMinutes} minutes.` : undefined} />
          </div>
        )}
        {shown && <p className="text-sm">Recorded duration <span className="font-medium">{shown}</span></p>}
        <TextArea label="What work did you do?" value={words} onChange={setWords} isRequired maxLength={2000} />
        <RadioGroup label="Time classification" value={isBillable ? "billable" : "non"} onChange={(value) => setBillable(value === "billable")} isDisabled={!project}>
          <Radio value="billable" isDisabled={!project?.billableAllowed}>{project?.billableAllowed ? "Billable — work may be charged to the customer" : "Billable — not available on this project"}</Radio>
          <Radio value="non">{project?.billingMethod === "FIXED_PRICE" || project?.billingMethod === "HYBRID" ? "Non-billable — included in the fixed price, or not chargeable" : "Non-billable — not separately charged"}</Radio>
        </RadioGroup>
        {isBillable && (project?.contractLines.length ?? 0) > 1 && (
          <Select label="Contract line" placeholder="The project's default line" selectedKey={lineId} onSelectionChange={(key) => setLineId(key ? String(key) : null)}
            options={project!.contractLines.map((line) => ({ value: line.id, label: line.label }))} />
        )}
        {isBillable && project?.billingMethod === "HYBRID" && project.contractLines.length === 1 && !lineId && (
          <Select label="Extra-service line" placeholder="Choose the authorized line" selectedKey={lineId} onSelectionChange={(key) => setLineId(key ? String(key) : null)}
            options={project.contractLines.map((line) => ({ value: line.id, label: line.label }))} />
        )}
        {isBillable && <p className="text-xs text-text-muted">Billing eligibility will be checked: time is invoiced only once approved and covered by the customer&apos;s commercial agreement.</p>}
        {!isBillable && project && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={`Reason${options.data?.reasonRequired && project.billableAllowed ? "" : " (optional)"}`} placeholder="Choose a reason" selectedKey={reasonCode} onSelectionChange={(key) => setReasonCode(key ? String(key) : null)}
              options={(options.data?.reasons ?? []).map((row) => ({ value: row.code, label: row.label }))} />
            {reasonCode === "OTHER" && <TextField label="Explain" value={reasonNote} onChange={setReasonNote} isRequired />}
          </div>
        )}
        {entry?.status === "CHANGES_REQUESTED" && (isBillable !== entry.billable || (reasonCode ?? null) !== (entry.reasonCode ?? null)) && (
          <TextField label="Why the classification changes" value={classificationReason} onChange={setClassificationReason} isRequired description="This time was submitted before." />
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !valid} onPress={save}>{entry ? "Save" : "Log time"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
