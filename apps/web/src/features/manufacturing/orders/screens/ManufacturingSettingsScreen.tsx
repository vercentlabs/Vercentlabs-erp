"use client";

// Manufacturing setup: who may approve their own orders, BOM revisions and extra material; how far accepted output may exceed the plan;
// whether every unit waits for inspection; whether an order may reserve part of its materials or be released short; when a BOM cost estimate
// counts as stale.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, PermissionState, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, getSettings, saveSettings, type MfgSettings } from "../api/mo-api";

export function ManufacturingSettingsScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "settings"), queryFn: getSettings });
  if (query.isLoading) return <LoadingState label="Loading setup" rows={4} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Manufacturing setup" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load setup" description={errorMessage(query.error)} />;
  }
  return <SettingsForm initial={query.data} />;
}

function SettingsForm({ initial }: { initial: MfgSettings }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<MfgSettings>(initial);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof MfgSettings>(key: K, value: MfgSettings[K]) => setForm({ ...form, [key]: value });
  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      const next = await saveSettings({ ...form, canManage: undefined, bomCostStaleAfterDays: Number(form.bomCostStaleAfterDays) });
      setForm(next);
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      setMessage({ tone: "success", text: "Setup saved." });
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const disabled = !form.canManage;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Manufacturing Setup" description="Approval, tolerance and inspection policy for bills of materials and manufacturing orders." />
      {disabled && <Notice tone="neutral">You can see the setup; changing it needs the Manufacturing settings permission.</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Panel title="Approvals" description="Independent approval is the default. Allow self-approval only where the company documents it (small teams).">
        <Checkbox isDisabled={disabled} isSelected={form.moSelfApprovalAllowed} onChange={(value) => set("moSelfApprovalAllowed", value)}>The person who submits an order may approve its release</Checkbox>
        <Checkbox isDisabled={disabled} isSelected={form.moVarianceSelfApprovalAllowed} onChange={(value) => set("moVarianceSelfApprovalAllowed", value)}>The person who asks for extra material may approve it</Checkbox>
        <Checkbox isDisabled={disabled} isSelected={form.bomSelfApprovalAllowed} onChange={(value) => set("bomSelfApprovalAllowed", value)}>The person who submits a BOM revision may approve it</Checkbox>
      </Panel>
      <Panel title="Production">
        <TextField isDisabled={disabled} label="Overproduction tolerance (%)" description="How far accepted output may exceed the planned quantity. 0 means never." inputMode="decimal" className="w-56"
          value={form.moOverproductionTolerancePct} onChange={(value) => set("moOverproductionTolerancePct", value)} />
        <Checkbox isDisabled={disabled} isSelected={form.moRequireInspection} onChange={(value) => set("moRequireInspection", value)}>Every unit produced waits for a quality decision before it is accepted</Checkbox>
        <Checkbox isDisabled={disabled} isSelected={form.moProductionMaterialCheck === "BLOCK"} onChange={(value) => set("moProductionMaterialCheck", value ? "BLOCK" : "WARN")}>
          Output is posted only when the materials for it are issued or reserved (otherwise it posts with a warning; a manager may record why it went ahead)
        </Checkbox>
      </Panel>
      <Panel title="Quality inspection" description="How production output is inspected. Independent review and no acceptance after a critical failure are the defaults.">
        <Checkbox isDisabled={disabled} isSelected={form.qiTemplateRequired} onChange={(value) => set("qiTemplateRequired", value)}>Every final inspection uses the product&apos;s checklist (no basic inspections)</Checkbox>
        <Checkbox isDisabled={disabled} isSelected={form.qiReviewRequired} onChange={(value) => set("qiReviewRequired", value)}>Every inspection is reviewed by someone other than the inspector before it is final</Checkbox>
        <Checkbox isDisabled={disabled} isSelected={form.qiDeviationAllowed} onChange={(value) => set("qiDeviationAllowed", value)}>
          Output that failed a critical check may be accepted under a documented, reviewed deviation (never for what law or safety requires)
        </Checkbox>
        <Checkbox isDisabled={disabled} isSelected={form.qiSampleDecidesBatch} onChange={(value) => set("qiSampleDecidesBatch", value)}>A sample decides every unit its inspection covers (otherwise only the units examined are decided)</Checkbox>
      </Panel>
      <Panel title="Material usage variance" description="How material use compared with the BOM is judged. Review and approval percents are the usage-variance warning and approval percents below; items and groups can override them.">
        <TextField isDisabled={disabled} label="Check for missing consumption when usage is under the BOM by more than (%)" inputMode="decimal" className="w-80"
          value={form.mvSavingReviewPct} onChange={(value) => set("mvSavingReviewPct", value)} />
        <TextField isDisabled={disabled} label="Approval needed when the usage cost variance exceeds (₹, optional)" inputMode="decimal" className="w-80"
          value={form.mvApprovalValueAbove ?? ""} onChange={(value) => set("mvApprovalValueAbove", value.trim() ? value : null)} />
        <Checkbox isDisabled={disabled} isSelected={form.mvBlockCompletion} onChange={(value) => set("mvBlockCompletion", value)}>An order completes only when every variance that needs approval is approved for its final figures</Checkbox>
      </Panel>
      <Panel title="Production holds" description="A hold always takes effect at once; these decide how production restarts and when a hold is overdue.">
        <Checkbox isDisabled={disabled} isSelected={form.phResumeApprovalRequired} onChange={(value) => set("phResumeApprovalRequired", value)}>Resuming a held order needs another manager&apos;s approval</Checkbox>
        <TextField isDisabled={disabled} label="A hold is overdue after (hours)" inputMode="numeric" className="w-56" value={String(form.phOverdueAfterHours)}
          onChange={(value) => set("phOverdueAfterHours", Number(value) || 0)} description="Its owners are told once when it passes this." />
      </Panel>
      <Panel title="Materials" description="How orders behave when stock does not cover every material.">
        <Checkbox isDisabled={disabled} isSelected={form.moPartialReservationAllowed} onChange={(value) => set("moPartialReservationAllowed", value)}>An order may reserve what is in stock when not everything is (the person confirms; the rest stays short)</Checkbox>
        <Checkbox isDisabled={disabled} isSelected={form.moReleaseWithShortagesAllowed} onChange={(value) => set("moReleaseWithShortagesAllowed", value)}>An order may be released while materials are short</Checkbox>
      </Panel>
      <Panel title="Material issue" description="How storekeepers issue material to production.">
        <Checkbox isDisabled={disabled} isSelected={form.miUnreservedIssueAllowed} onChange={(value) => set("miUnreservedIssueAllowed", value)}>An issue may take free stock beyond the order’s reservation (never another order’s)</Checkbox>
        <TextField isDisabled={disabled} label="Issue tolerance (%)" description="How far an issue may exceed what the order may still issue without an approval. 0 means every excess is approved." inputMode="decimal" className="w-56"
          value={form.miExcessTolerancePct} onChange={(value) => set("miExcessTolerancePct", value)} />
      </Panel>
      <Panel title="Material consumption" description="When usage beyond the BOM's expectation for the output it made needs a second person.">
        <div className="flex flex-wrap gap-3">
          <TextField isDisabled={disabled} label="Warning above (%)" inputMode="decimal" className="w-48" value={form.mcVarianceWarningPct} onChange={(value) => set("mcVarianceWarningPct", value)} />
          <TextField isDisabled={disabled} label="Approval above (%)" description="Usage this far above the BOM waits for an approval." inputMode="decimal" className="w-56"
            value={form.mcVarianceApprovalPct} onChange={(value) => set("mcVarianceApprovalPct", value)} />
        </div>
        <Checkbox isDisabled={disabled} isSelected={form.mcSelfApprovalAllowed} onChange={(value) => set("mcSelfApprovalAllowed", value)}>The person who records usage may approve its variance</Checkbox>
      </Panel>
      <Panel title="BOM costing">
        <TextField isDisabled={disabled} label="A cost is stale after (days)" inputMode="numeric" className="w-56" value={String(form.bomCostStaleAfterDays)}
          onChange={(value) => set("bomCostStaleAfterDays", Number(value) || 0)} />
      </Panel>
      {!disabled && <div className="flex justify-end"><Button variant="primary" isLoading={busy} onPress={save}>Save</Button></div>}
    </div>
  );
}
