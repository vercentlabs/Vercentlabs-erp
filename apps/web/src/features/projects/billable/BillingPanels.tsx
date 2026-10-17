"use client";

// Projects — Billable / Non-Billable Time on a project's Time & Expenses tab: the separate measures (recorded, billable, approved, reserved,
// invoiced, free to request), non-billable time by reason, and the billing policy — its method and versions, the contract lines authorized
// from the customer's sales order lines (rates only for those who may see billing) and task rules.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ComboBox, Dialog, MetricStrip, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, type Project } from "../api/projects-api";
import { getTimeTasks, hours } from "../timesheets/timesheets-api";
import { authorizeLine, closeLine, getBillingPolicy, getBillingSummary, getLineCandidates, setBillingPolicy, setTaskRule, type BillingPolicy } from "./billable-api";

export function BillableSummaryPanel({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-billing-summary", project.id), queryFn: () => getBillingSummary(project.id) });
  if (summary.isLoading) return <LoadingState label="Loading billable time" rows={3} />;
  if (!summary.data) return null;
  const s = summary.data;
  return (
    <Panel title={s.scope === "MINE" ? "Your billable and non-billable time" : "Billable time summary"}
      description="Classified billable is not approved, and approved is not invoiced: each is counted on its own.">
      <MetricStrip metrics={[{ label: "Total recorded", value: hours(s.recordedMinutes) }, { label: "Billable", value: hours(s.billableMinutes) }, { label: "Non-billable", value: hours(s.nonBillableMinutes) },
        { label: "Billable awaiting approval", value: hours(s.billablePendingApprovalMinutes) }]} />
      <MetricStrip metrics={[{ label: "Approved billable", value: hours(s.approvedBillableMinutes) }, { label: "Invoiced", value: hours(s.invoicedMinutes) },
        { label: "Reserved for billing", value: hours(s.reservedMinutes) }, { label: "Free to request", value: s.values ? `${hours(s.availableToRequestMinutes)} · ${s.values.availableToRequest}` : hours(s.availableToRequestMinutes) }]} />
      {s.approvedAwaitingContractMinutes > 0 && <Notice tone="warning">{`${hours(s.approvedAwaitingContractMinutes)} of approved billable time waits for a contract line before it can be billed.`}</Notice>}
      {s.nonBillableByReason.length > 0 && (
        <LinesTable columns={["Non-billable reason", { label: "Time", numeric: true }]}>
          {s.nonBillableByReason.map((row) => <tr key={row.reasonCode}><Cell>{row.reason}</Cell><Cell numeric>{hours(row.minutes)}</Cell></tr>)}
        </LinesTable>
      )}
      {s.billableRatio !== null && <p className="text-xs text-text-muted">{`Billable share of approved time: ${s.billableRatio}%. A lower share is not inefficiency — fixed-price and internal work is often valuable.`}</p>}
    </Panel>
  );
}

const TASK_TYPES = ["GENERAL", "DESIGN", "BUILD", "CONFIGURATION", "DATA", "TESTING", "DOCUMENTATION", "MEETING", "OTHER"];

export function BillingPolicyPanel({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const policy = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-billing-policy", project.id), queryFn: () => getBillingPolicy(project.id) });
  const [dialog, setDialog] = useState<"method" | "line" | "task" | { close: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (policy.isLoading) return <LoadingState label="Loading the billing policy" rows={3} />;
  if (!policy.data) return <Notice tone="danger">{errorMessage(policy.error)}</Notice>;
  const p = policy.data;
  const done = async (text: string) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage({ tone: "success", text }); };
  const hourly = p.method === "TIME_AND_MATERIALS" || p.method === "HYBRID";
  return (
    <Panel title="Time billing policy" description={`${p.methodLabel}${p.reference ? ` · ${p.reference}` : ""}${p.implicit ? " (company default)" : ` · version ${p.version}`}`}
      actions={<>
        {p.can.manage && <Button size="compact" variant="secondary" onPress={() => setDialog("method")}>Change method</Button>}
        {p.can.authorizeLines && hourly && <Button size="compact" variant="secondary" onPress={() => setDialog("line")}>Authorize a contract line</Button>}
        {p.can.manage && <Button size="compact" variant="ghost" onPress={() => setDialog("task")}>Task rule</Button>}
      </>}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {p.method === "FIXED_PRICE" && <p className="text-sm text-text-secondary">Time is recorded for effort and cost. It is never billed by the hour: the customer pays the agreed amount through the sales order or milestones.</p>}
      {p.method === "HYBRID" && <p className="text-sm text-text-secondary">Work is included in the fixed price, except work on an authorized extra-service line below.</p>}
      {hourly && (
        <LinesTable empty="No contract line yet: billable time waits for one before it can be billed." columns={["Line", "Sales order", ...(p.can.viewRates ? [{ label: "Rate", numeric: true }] : []), "Covers", { label: "Used / allowed", numeric: true }, "Status", ""]}>
          {p.lines.map((line) => (
            <tr key={line.id}>
              <Cell><span className="flex flex-col"><span>{line.label}</span><span className="text-xs text-text-muted">{line.number}</span></span></Cell>
              <Cell>{line.salesOrderNumber}</Cell>
              {p.can.viewRates && <Cell numeric>{`${line.hourlyRate} ${line.currency ?? ""}/h`}</Cell>}
              <Cell><span className="text-xs">{`${line.effectiveFrom}${line.effectiveTo ? ` to ${line.effectiveTo}` : " onwards"}${line.allowedTaskTypes ? ` · ${line.allowedTaskTypes.join(", ").toLowerCase()}` : ""}${line.roundingMinutes > 1 ? ` · ${line.roundingMinutes}-minute steps` : ""}`}</span></Cell>
              <Cell numeric>{`${hours(line.usedMinutes)}${line.maxMinutes ? ` / ${hours(line.maxMinutes)}` : ""}`}</Cell>
              <Cell><StatusBadge tone={line.status === "ACTIVE" ? "success" : "neutral"}>{line.status === "ACTIVE" ? "Active" : "Closed"}</StatusBadge>{line.closeReason && <span className="block text-xs text-text-muted">{line.closeReason}</span>}</Cell>
              <Cell>{line.status === "ACTIVE" && p.can.authorizeLines && <Button size="compact" variant="ghost" onPress={() => setDialog({ close: line.id })}>Close</Button>}</Cell>
            </tr>
          ))}
        </LinesTable>
      )}
      {p.taskRules.length > 0 && (
        <LinesTable columns={["Task", "Rule"]}>
          {p.taskRules.map((rule) => <tr key={rule.taskId}><Cell>{rule.task}</Cell><Cell>{rule.rule === "NON_BILLABLE" ? `Non-billable — ${rule.reason}` : `Billed on ${p.lines.find((line) => line.id === rule.contractLineId)?.label ?? "its line"}`}</Cell></tr>)}
        </LinesTable>
      )}
      {p.history.length > 1 && <p className="text-xs text-text-muted">{p.history.map((row) => `v${row.version} ${row.methodLabel} (${row.setBy ?? "—"}, ${formatDateTime(row.setAt)})`).join(" · ")}</p>}
      {dialog === "method" && <MethodDialog policy={p} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "line" && <LineDialog policy={p} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "task" && <TaskRuleDialog policy={p} onClose={() => setDialog(null)} onDone={done} />}
      {dialog && typeof dialog === "object" && <CloseLineDialog lineId={dialog.close} onClose={() => setDialog(null)} onDone={done} />}
    </Panel>
  );
}

function Footer({ busy, disabled, label, onClose, onPress }: { busy: boolean; disabled?: boolean; label: string; onClose: () => void; onPress: () => void }) {
  return <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} isDisabled={busy || disabled} onPress={onPress}>{label}</Button></div>;
}
function useRun(onClose: () => void, onDone: (text: string) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true); setError(null);
    try { await work(); await onDone(text); onClose(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return { busy, error, run };
}
type DialogProps = { policy: BillingPolicy; onClose: () => void; onDone: (text: string) => Promise<void> };

function MethodDialog({ policy, onClose, onDone }: DialogProps) {
  const [method, setMethod] = useState<string>(policy.method ?? (policy.classification === "INTERNAL" ? "INTERNAL" : "NON_BILLABLE"));
  const [line, setLine] = useState<string | null>(policy.defaultContractLineId);
  const [reference, setReference] = useState(policy.reference ?? "");
  const [note, setNote] = useState("");
  const { busy, error, run } = useRun(onClose, onDone);
  const options = policy.methods.filter((row) => policy.classification === "CUSTOMER" || ["INTERNAL", "NON_BILLABLE"].includes(row.code));
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="How this project's time is billed"
      description="A change is a new policy version. Approved time keeps the classification it was approved under; unsubmitted time is classified again when saved or submitted.">
      <div className="flex flex-col gap-3">
        <Select label="Billing method" selectedKey={method} onSelectionChange={(key) => setMethod(String(key))} options={options.map((row) => ({ value: row.code, label: row.label }))} />
        {method === "TIME_AND_MATERIALS" && policy.lines.some((row) => row.status === "ACTIVE") && (
          <Select label="Default contract line (optional)" selectedKey={line} onSelectionChange={(key) => setLine(key ? String(key) : null)}
            options={policy.lines.filter((row) => row.status === "ACTIVE").map((row) => ({ value: row.id, label: row.label }))} description="Used when time names no line and several apply." />
        )}
        <TextField label="Commercial reference" value={reference} onChange={setReference} description="The contract or order this policy rests on." />
        <TextArea label="Note" value={note} onChange={setNote} />
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} label="Save policy" onClose={onClose} onPress={() => run(() => setBillingPolicy(policy.projectId, { billingMethod: method, defaultContractLineId: method === "TIME_AND_MATERIALS" ? line : null,
          reference: reference || undefined, note: note || undefined, expectedVersion: policy.version }), "Billing policy saved.")} />
      </div>
    </Dialog>
  );
}

function LineDialog({ policy, onClose, onDone }: DialogProps) {
  const workspace = useWorkspaceContext();
  const candidates = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-line-candidates", policy.projectId), queryFn: () => getLineCandidates(policy.projectId) });
  const [lineId, setLineId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cap, setCap] = useState("");
  const [rounding, setRounding] = useState("1");
  const [types, setTypes] = useState<string | null>(null);
  const { busy, error, run } = useRun(onClose, onDone);
  const chosen = candidates.data?.find((row) => row.salesOrderLineId === lineId);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="Authorize hourly billing"
      description="A service line of a confirmed sales order of this customer, linked to the project. The rate and currency are the order's; they cannot be typed here.">
      <div className="flex flex-col gap-3">
        <ComboBox label="Sales order line" placeholder="Choose a line" selectedKey={lineId} onSelectionChange={(key) => setLineId(key ? String(key) : null)} isLoading={candidates.isLoading}
          emptyMessage="Link the customer's sales order to the project first."
          options={(candidates.data ?? []).map((row) => ({ value: row.salesOrderLineId, label: `${row.salesOrderNumber} · ${row.item}${row.why ? ` — ${row.why}` : ""}`, isDisabled: !row.eligible }))} />
        {chosen && <p className="text-xs text-text-muted">{`${chosen.quantity ?? "—"} ${chosen.uom ?? ""} at ${chosen.unitPrice ?? "no price"} ${chosen.currency ?? ""}`}</p>}
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Applies from" type="date" value={from} onChange={setFrom} isRequired />
          <TextField label="Until (optional)" type="date" value={to} onChange={setTo} />
          <TextField label="Maximum hours (optional)" inputMode="decimal" value={cap} onChange={setCap} description="The order's hours when it is sold in hours." />
          <Select label="Bill in steps of" selectedKey={rounding} onSelectionChange={(key) => setRounding(String(key))}
            options={["1", "5", "6", "10", "15", "30", "60"].map((n) => ({ value: n, label: `${n} minute${n === "1" ? "" : "s"}` }))} />
        </div>
        <Select label="Covers (optional)" placeholder="Any kind of work" selectedKey={types} onSelectionChange={(key) => setTypes(key ? String(key) : null)}
          options={TASK_TYPES.map((type) => ({ value: type, label: type.charAt(0) + type.slice(1).toLowerCase() }))} />
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} disabled={!lineId || !from} label="Authorize" onClose={onClose} onPress={() => run(() => authorizeLine(policy.projectId, { salesOrderLineId: lineId, effectiveFrom: from,
          effectiveTo: to || undefined, maxMinutes: cap ? Math.round(Number(cap) * 60) : undefined, roundingMinutes: Number(rounding), allowedTaskTypes: types ? [types] : undefined }), "Contract line authorized.")} />
      </div>
    </Dialog>
  );
}

function CloseLineDialog({ lineId, onClose, onDone }: { lineId: string; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useRun(onClose, onDone);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="Close the contract line"
      description="It stops authorizing new time (a rate change is a new line). Time already classified on it, and its billing, keep it.">
      <div className="flex flex-col gap-3">
        <TextArea label="Why" value={reason} onChange={setReason} isRequired />
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} disabled={reason.trim().length < 3} label="Close line" onClose={onClose} onPress={() => run(() => closeLine(lineId, reason), "Contract line closed.")} />
      </div>
    </Dialog>
  );
}

function TaskRuleDialog({ policy, onClose, onDone }: DialogProps) {
  const workspace = useWorkspaceContext();
  const tasks = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-tasks", policy.projectId, ""), queryFn: () => getTimeTasks(policy.projectId) });
  const [taskId, setTaskId] = useState<string | null>(null);
  const [rule, setRule] = useState("NON_BILLABLE");
  const [reason, setReason] = useState("NON_BILLABLE_CONTRACT");
  const [line, setLine] = useState<string | null>(null);
  const { busy, error, run } = useRun(onClose, onDone);
  const active = policy.lines.filter((row) => row.status === "ACTIVE");
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="Billing rule for a task" description="Hold a task non-billable, or bill it on one contract line (the extra service on a hybrid project).">
      <div className="flex flex-col gap-3">
        <ComboBox label="Task" placeholder="Choose a task" selectedKey={taskId} onSelectionChange={(key) => setTaskId(key ? String(key) : null)} options={(tasks.data?.tasks ?? []).map((row) => ({ value: row.id, label: row.label }))} />
        <Select label="Rule" selectedKey={rule} onSelectionChange={(key) => setRule(String(key))}
          options={[{ value: "NON_BILLABLE", label: "Non-billable" }, ...(active.length ? [{ value: "CONTRACT_LINE", label: "Billed on a contract line" }] : []), { value: "NONE", label: "Follow the project's policy" }]} />
        {rule === "NON_BILLABLE" && <Select label="Reason" selectedKey={reason} onSelectionChange={(key) => setReason(String(key))} options={policy.reasons.filter((row) => row.code !== "OTHER").map((row) => ({ value: row.code, label: row.label }))} />}
        {rule === "CONTRACT_LINE" && <Select label="Contract line" selectedKey={line} onSelectionChange={(key) => setLine(key ? String(key) : null)} options={active.map((row) => ({ value: row.id, label: row.label }))} />}
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} disabled={!taskId || (rule === "CONTRACT_LINE" && !line)} label="Save rule" onClose={onClose}
          onPress={() => run(() => setTaskRule(taskId!, rule === "NONE" ? { rule: null } : { rule, reasonCode: rule === "NON_BILLABLE" ? reason : undefined, contractLineId: rule === "CONTRACT_LINE" ? line : undefined }), "Task rule saved.")} />
      </div>
    </Dialog>
  );
}
