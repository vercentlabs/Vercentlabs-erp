"use client";

// The company negative-stock policy on Inventory settings: Block (the default) or Allow with authorised override (untracked items only, with the
// override permission and a reason every time). There is no unrestricted allow. Changing it is audited with an optional reason.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Select, TextField } from "@vercentlabs/design-system";

import { InvAlert, InvPanel } from "@/features/inventory/shared/InvUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { NEGATIVE_STOCK_BASE, errorMessage, getNegativeSettings, updateNegativeSettings, type NegativePolicy } from "../api/negative-stock-api";

export function NegativeStockPolicyPanel() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "negative-stock", "settings");
  const settings = useQuery({ queryKey: key, queryFn: getNegativeSettings });
  const [policy, setPolicy] = useState<NegativePolicy | null>(null);
  const [alerts, setAlerts] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => updateNegativeSettings({ policy: policy ?? undefined, alertsEnabled: alerts ?? undefined, reason: reason || null }),
    onSuccess: (data) => { queryClient.setQueryData(key, data); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "negative-stock") }); setSaved(true); setReason(""); },
  });
  const current = settings.data;
  const editable = Boolean(current?.capabilities.configure);
  const chosen = policy ?? current?.policy ?? null;
  return (
    <InvPanel title="Negative stock" description="Whether a stock-consuming transaction may ever take physical stock below zero.">
      {settings.isError && <InvAlert>{errorMessage(settings.error)}</InvAlert>}
      {save.isError && <InvAlert>{errorMessage(save.error)}</InvAlert>}
      {saved && <InvAlert tone="success">Negative-stock policy saved.</InvAlert>}
      <div className="grid max-w-xl grid-cols-1 gap-3">
        <Select label="Negative stock policy" isDisabled={!editable || !current} selectedKey={chosen}
          options={(current?.policies ?? []).map((entry) => ({ value: entry.id, label: entry.label }))}
          onSelectionChange={(value) => { setSaved(false); setPolicy(String(value) as NegativePolicy); }}
          description={chosen === "allow_with_override"
            ? "An authorised user may post an untracked item below zero with a reason. Batch, serial and transit stock, reserved stock, transfers, purchase returns and counts are still always blocked."
            : "No transaction may make a stock position negative."} />
        <Checkbox isSelected={alerts ?? current?.alertsEnabled ?? true} isDisabled={!editable || !current} onChange={(value) => { setSaved(false); setAlerts(value); }}>
          Show the negative-stock badge in Inventory when negative positions are open
        </Checkbox>
        {editable && (policy !== null || alerts !== null) && <TextField label="Reason for the change (optional, kept in the audit)" value={reason} onChange={setReason} />}
        <p className="text-sm text-text-muted">{current ? `${current.blockedItems} item${current.blockedItems === 1 ? "" : "s"} always block negative stock whatever the policy.` : ""}{" "}
          <Link className="text-brand hover:underline" href={NEGATIVE_STOCK_BASE}>Negative stock report</Link></p>
      </div>
      {editable ? <div><Button variant="primary" isDisabled={policy === null && alerts === null} isLoading={save.isPending} onPress={() => save.mutate()}>Save negative-stock policy</Button></div>
        : current && <p className="text-sm text-text-muted">You can view this policy but not change it.</p>}
    </InvPanel>
  );
}
