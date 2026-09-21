"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NumberField, PageHeader, Select } from "@vercentlabs/design-system";

import { act, AssetsApiError, readView } from "@/features/assets/shared/client";
import { AssetsAlert, AssetsPanel, useCan } from "@/features/assets/shared/AssetsUi";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

type S = Record<string, unknown>;
const TOGGLES: Array<[string, string, string]> = [
  ["requireCapitalizationApproval", "require_capitalization_approval", "Capitalization needs a different person from the one who registered the asset"],
  ["requireTransferApproval", "require_transfer_approval", "Transfers need approval before they complete"],
  ["requireValueAdjustmentApproval", "require_value_adjustment_approval", "Revaluations and impairments need a second approver"],
  ["requireDisposalApproval", "require_disposal_approval", "Disposals need approval before they complete"],
  ["prohibitSelfApproval", "prohibit_self_approval", "Nobody can approve what they requested (segregation of duties)"],
  ["postToAccounting", "post_to_accounting", "Post capitalization, depreciation, adjustments and disposals to the general ledger"],
];

export function AssetsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "settings"), queryFn: async () => (await readView<{ settings: S }>("settings")).settings });
  const [edits, setEdits] = useState<S>({});
  const form: S = { ...(query.data ?? {}), ...edits };
  const setForm = (update: (f: S) => S) => setEdits((current) => ({ ...current, ...update({ ...(query.data ?? {}), ...current }) }));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => act("settings-save", {
      requireCapitalizationApproval: form.require_capitalization_approval, requireTransferApproval: form.require_transfer_approval, requireValueAdjustmentApproval: form.require_value_adjustment_approval,
      requireDisposalApproval: form.require_disposal_approval, prohibitSelfApproval: form.prohibit_self_approval, postToAccounting: form.post_to_accounting,
      defaultDepreciationMethod: form.default_depreciation_method, depreciationConvention: form.depreciation_convention,
      warrantyAlertDays: form.warranty_alert_days, maintenanceLeadDays: form.maintenance_lead_days, calibrationAlertDays: form.calibration_alert_days,
    }),
    onSuccess: () => { setMessage("Settings saved."); setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); },
    onError: (e) => { setError(e instanceof AssetsApiError ? e.message : "This could not be saved."); setMessage(null); },
  });
  const editable = can("assets.settings.manage");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Asset settings" description="Approval controls, depreciation defaults and alert windows for this company." />
      {error && <AssetsAlert>{error}</AssetsAlert>}
      {message && <AssetsAlert tone="success">{message}</AssetsAlert>}
      <AssetsPanel title="Controls">
        <div className="flex flex-col gap-2">
          {TOGGLES.map(([, column, text]) => (
            <label key={column} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" disabled={!editable} checked={Boolean(form[column])} onChange={(e) => setForm((f) => ({ ...f, [column]: e.target.checked }))} />
              <span>{text}</span>
            </label>
          ))}
        </div>
      </AssetsPanel>
      <AssetsPanel title="Defaults and alerts">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Default depreciation method" isDisabled={!editable} options={["straight_line", "declining_balance", "units_of_production", "none"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }))} selectedKey={String(form.default_depreciation_method ?? "straight_line")} onSelectionChange={(k) => setForm((f) => ({ ...f, default_depreciation_method: String(k) }))} />
          <Select label="Depreciation convention" isDisabled={!editable} options={["full_month", "mid_month", "next_month"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }))} selectedKey={String(form.depreciation_convention ?? "full_month")} onSelectionChange={(k) => setForm((f) => ({ ...f, depreciation_convention: String(k) }))} />
          <NumberField label="Warranty alert (days)" isDisabled={!editable} value={Number(form.warranty_alert_days ?? 30)} onChange={(v) => setForm((f) => ({ ...f, warranty_alert_days: v }))} minValue={0} />
          <NumberField label="Maintenance lead (days)" isDisabled={!editable} value={Number(form.maintenance_lead_days ?? 7)} onChange={(v) => setForm((f) => ({ ...f, maintenance_lead_days: v }))} minValue={0} />
          <NumberField label="Calibration alert (days)" isDisabled={!editable} value={Number(form.calibration_alert_days ?? 30)} onChange={(v) => setForm((f) => ({ ...f, calibration_alert_days: v }))} minValue={0} />
        </div>
        {editable && <div className="flex justify-end"><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save settings</Button></div>}
      </AssetsPanel>
    </div>
  );
}
