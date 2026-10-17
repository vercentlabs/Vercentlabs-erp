"use client";

// Projects — Billable / Non-Billable Time reports, as a set of Project Reports, and the company's billing defaults in Project Settings.
// Operational hours and invoiced hours are reported apart; invoiced value is Sales's, never cash or recognized revenue.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Select } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage } from "../api/projects-api";
import { hours } from "../timesheets/timesheets-api";
import { getBillingSettings, saveBillingSettings, type BillingSettings } from "./billable-api";

export const BILLABLE_REPORT_TABS = [{ id: "bt-billable-vs-nonbillable", label: "Billable vs non-billable" }, { id: "bt-by-project", label: "By project" }, { id: "bt-by-employee", label: "By employee" },
  { id: "bt-nonbillable-by-reason", label: "Non-billable by reason" }, { id: "bt-approved-billable", label: "Approved billable" }, { id: "bt-pending-approval", label: "Pending approval" },
  { id: "bt-approved-unbilled", label: "Unbilled time" }, { id: "bt-partially-billed", label: "Partially billed" }, { id: "bt-invoiced", label: "Invoiced hours" },
  { id: "bt-fixed-fee-included", label: "Fixed-fee included" }, { id: "bt-value-estimate", label: "Billable value" }, { id: "bt-invoiced-value", label: "Invoiced value" },
  { id: "bt-labor-cost", label: "Labor cost" }, { id: "bt-corrections", label: "Billing corrections" }, { id: "bt-exceptions", label: "Billing exceptions" }];

type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const h = (value: unknown) => (value === null || value === undefined ? "—" : hours(Number(value)));
const CLASS = { NON_BILLABLE: "Non-billable", INCLUDED_IN_FIXED_FEE: "Included in fixed fee", TIME_AND_MATERIALS_ELIGIBLE: "Billable (hourly)", ELIGIBILITY_PENDING: "Billable — line pending" } as Record<string, string>;
const STATUS = { DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested" } as Record<string, string>;
const REASON = { INTERNAL_WORK: "Internal work", INCLUDED_IN_CONTRACT: "Included in contract", INTERNAL_MEETING: "Internal meeting", TRAINING: "Training", REWORK_INTERNAL: "Internal rework",
  GOODWILL_SUPPORT: "Goodwill support", NON_BILLABLE_CONTRACT: "Excluded by contract", OTHER: "Other", UNSPECIFIED: "No reason recorded" } as Record<string, string>;

export function BillableReport({ kind, rows }: { kind: string; rows: Row[] }) {
  switch (kind) {
    case "bt-billable-vs-nonbillable": return (
      <LinesTable columns={["Classification", "Approval", { label: "Hours", numeric: true }, { label: "Entries", numeric: true }]}>
        {rows.map((row, i) => <tr key={i}><Cell>{CLASS[s(row.classification)]}</Cell><Cell>{STATUS[s(row.status)] ?? s(row.status)}</Cell><Cell numeric>{h(row.minutes)}</Cell><Cell numeric>{s(row.entries)}</Cell></tr>)}
      </LinesTable>
    );
    case "bt-by-project": case "bt-by-employee": return (
      <LinesTable columns={[kind === "bt-by-project" ? "Project" : "Employee", { label: "Recorded", numeric: true }, { label: "Billable", numeric: true }, { label: "Non-billable", numeric: true },
        { label: "Approved billable", numeric: true }, { label: "Billable pending", numeric: true }, ...(kind === "bt-by-project" ? [{ label: "Invoiced", numeric: true }, { label: "Reserved", numeric: true }] : [])]}>
        {rows.map((row, i) => <tr key={i}><Cell>{kind === "bt-by-project" ? `${s(row.project_code)} ${s(row.project_name)}` : s(row.employee_user_id_name)}</Cell><Cell numeric>{h(row.recorded)}</Cell>
          <Cell numeric>{h(row.billable)}</Cell><Cell numeric>{h(row.non_billable)}</Cell><Cell numeric>{h(row.approved_billable)}</Cell><Cell numeric>{h(row.billable_pending)}</Cell>
          {kind === "bt-by-project" && <><Cell numeric>{h(row.invoiced)}</Cell><Cell numeric>{h(row.reserved)}</Cell></>}</tr>)}
      </LinesTable>
    );
    case "bt-nonbillable-by-reason": return (
      <LinesTable columns={["Classification", "Reason", { label: "Hours", numeric: true }, { label: "Entries", numeric: true }]}>
        {rows.map((row, i) => <tr key={i}><Cell>{CLASS[s(row.classification)]}</Cell><Cell>{REASON[s(row.reason)] ?? s(row.reason)}</Cell><Cell numeric>{h(row.minutes)}</Cell><Cell numeric>{s(row.entries)}</Cell></tr>)}
      </LinesTable>
    );
    case "bt-fixed-fee-included": return (
      <LinesTable columns={["Project", { label: "Included hours", numeric: true }, { label: "Approved", numeric: true }]}>
        {rows.map((row, i) => <tr key={i}><Cell>{`${s(row.project_code)} ${s(row.project_name)}`}</Cell><Cell numeric>{h(row.minutes)}</Cell><Cell numeric>{h(row.approved)}</Cell></tr>)}
      </LinesTable>
    );
    case "bt-approved-billable": case "bt-pending-approval": case "bt-approved-unbilled": case "bt-partially-billed": case "bt-invoiced": case "bt-value-estimate": return (
      <LinesTable columns={["Entry", "Employee", "Project", "Date", { label: "Hours", numeric: true }, { label: "Invoiced", numeric: true }, { label: "Reserved", numeric: true }, "Line", ...(rows.some((row) => row.value !== undefined) ? [{ label: "Value", numeric: true }] : [])]}>
        {rows.map((row) => <tr key={s(row.id)}><Cell>{`TE-${s(row.entry_number)}`}</Cell><Cell>{s(row.employee_user_id_name)}</Cell><Cell>{s(row.project_code)}</Cell><Cell>{s(row.work_date)}</Cell>
          <Cell numeric>{h(row.duration_minutes)}</Cell><Cell numeric>{h(row.invoiced)}</Cell><Cell numeric>{h(row.reserved)}</Cell><Cell>{s(row.contract_line) || CLASS[s(row.billing_classification)]}</Cell>
          {row.value !== undefined && <Cell numeric>{`${s(row.value)} ${s(row.currency)}`}</Cell>}</tr>)}
      </LinesTable>
    );
    case "bt-invoiced-value": return (
      <LinesTable columns={["Request", "Project", "Invoice", { label: "Hours", numeric: true }, { label: "Credited", numeric: true }, { label: "Estimated", numeric: true }, { label: "Invoiced", numeric: true }, "Status"]}>
        {rows.map((row, i) => <tr key={i}><Cell>{`BR-${s(row.request_number)}`}</Cell><Cell>{s(row.project_code)}</Cell><Cell>{`${s(row.invoice_number)} (${s(row.invoice_status)})`}</Cell>
          <Cell numeric>{h(row.total_minutes)}</Cell><Cell numeric>{h(row.credited_minutes)}</Cell><Cell numeric>{s(row.estimated_amount)}</Cell><Cell numeric>{`${s(row.invoiced_amount)} ${s(row.currency)}`}</Cell>
          <Cell>{s(row.status).toLowerCase()}</Cell></tr>)}
      </LinesTable>
    );
    case "bt-labor-cost": return (
      <LinesTable columns={["Project", "Classification", { label: "Approved", numeric: true }, { label: "Labor cost", numeric: true }, "Without a rate"]}>
        {rows.map((row, i) => <tr key={i}><Cell>{`${s(row.project_code)} ${s(row.project_name)}`}</Cell><Cell>{CLASS[s(row.classification)]}</Cell><Cell numeric>{h(row.minutes)}</Cell>
          <Cell numeric>{row.cost === null ? "—" : `${s(row.cost)} ${s(row.currency)}`}</Cell><Cell>{Number(row.without_rate) ? s(row.without_rate) : "—"}</Cell></tr>)}
      </LinesTable>
    );
    case "bt-corrections": return (
      <LinesTable columns={["Correction", "Employee", "Project", "Change", "Reason", "Status", "Billing adjustment", "Requested"]}>
        {rows.map((row, i) => {
          const original = (row.original ?? {}) as Row;
          const proposed = (row.proposed ?? {}) as Row;
          const parts = (proposed.parts as Row[] | undefined) ?? [proposed];
          return <tr key={i}><Cell>{`TC-${s(row.correction_number)}`}</Cell><Cell>{s(row.employee_user_id_name)}</Cell><Cell>{s(row.project_code)}</Cell>
            <Cell>{`${CLASS[s(original.classification)] ?? "—"} → ${parts.map((part) => `${h(part.durationMinutes)} ${CLASS[s(part.classification)] ?? ""}`).join(" + ")}`}</Cell>
            <Cell>{s(row.reason)}</Cell><Cell>{s(row.status).toLowerCase()}</Cell><Cell>{row.billing_adjustment_required ? s(row.billing_adjustment_reference) || "Needed" : "—"}</Cell>
            <Cell>{formatDateTime(s(row.requested_at))}</Cell></tr>;
        })}
      </LinesTable>
    );
    case "bt-exceptions": return (
      <LinesTable columns={["What", "Detail"]}>
        {rows.map((row, i) => <tr key={i}><Cell>{s(row.label)}</Cell><Cell>{s(row.message)}</Cell></tr>)}
      </LinesTable>
    );
    default: return null;
  }
}

const METHODS = [{ value: "NON_BILLABLE", label: "Non-billable" }, { value: "FIXED_PRICE", label: "Fixed price" }, { value: "TIME_AND_MATERIALS", label: "Time and materials" },
  { value: "REQUIRE_SETUP", label: "Set up each project before billable time is recorded" }];
export function BillingSettingsPanel() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-billing-settings"), queryFn: getBillingSettings });
  const [draft, setDraft] = useState<Partial<BillingSettings> | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (settings.isLoading) return <LoadingState label="Loading billing defaults" rows={2} />;
  if (!settings.data) return <Notice tone="danger">{errorMessage(settings.error)}</Notice>;
  const value = { ...settings.data, ...draft };
  const manage = settings.data.can.manage;
  return (
    <Panel title="Time billing" description="Defaults for billable and non-billable time. Internal projects are always non-billable; each project can set its own policy.">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Select label="Customer projects without a policy" isDisabled={!manage} selectedKey={value.defaultMethod} onSelectionChange={(key) => setDraft({ ...draft, defaultMethod: String(key) as BillingSettings["defaultMethod"] })} options={METHODS} />
      <Checkbox isDisabled={!manage} isSelected={value.reasonRequired} onChange={(on) => setDraft({ ...draft, reasonRequired: on })}>Non-billable time on billable projects needs a reason</Checkbox>
      <Checkbox isDisabled={!manage} isSelected={value.requestApproval} onChange={(on) => setDraft({ ...draft, requestApproval: on })}>A second person authorizes each billing request before it goes to Sales</Checkbox>
      {manage && <div className="flex justify-end"><Button variant="primary" isLoading={busy} isDisabled={busy || !draft} onPress={async () => {
        setBusy(true); setMessage(null);
        try { await saveBillingSettings(draft ?? {}); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setDraft(null); setMessage({ tone: "success", text: "Billing defaults saved." }); }
        catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
      }}>Save billing defaults</Button></div>}
    </Panel>
  );
}
