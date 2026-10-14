"use client";

// Variance tolerances: the company's bands (in Manufacturing Setup) overridden per item group or item — warning and approval percents, an
// optional quantity or value threshold, the saving that prompts a check for missing consumption, and critical materials. An override
// replaces the one in force (its version goes up); approvals record the policy they were given under.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ComboBox, ErrorState, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { bomOptions } from "@/features/manufacturing/boms/api/bom-api";
import { errorMessage, errorStatus, inr } from "@/features/manufacturing/orders/api/mo-api";
import { listTolerances, removeTolerance, setTolerance } from "../api/variance-api";

export function VarianceTolerancesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "manufacturing", "variance-tolerances");
  const query = useQuery({ queryKey: key, queryFn: listTolerances });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-options"), queryFn: bomOptions, staleTime: 60_000 });
  const [scope, setScope] = useState<"ITEM" | "GROUP">("ITEM");
  const [target, setTarget] = useState<string | null>(null);
  const [warning, setWarning] = useState("2");
  const [approval, setApproval] = useState("5");
  const [saving, setSaving] = useState("");
  const [valueAbove, setValueAbove] = useState("");
  const [quantityAbove, setQuantityAbove] = useState("");
  const [critical, setCritical] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading tolerances" rows={5} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to material variance" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load tolerances" description={errorMessage(query.error)} />;
  }
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true); setMessage(null);
    try { await work(); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") }); setMessage({ tone: "success", text }); } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const targets = scope === "ITEM" ? (options.data?.materials ?? []).map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` })) : query.data.groups.map((row) => ({ value: row.id, label: row.name }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Variance Tolerances" description="How far material use may differ from the BOM before it needs review or approval. The company default is in Manufacturing Setup; an item's own tolerance comes before its group's." />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Panel title="Set a tolerance">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="For" selectedKey={scope} onSelectionChange={(value) => { setScope(String(value) as "ITEM" | "GROUP"); setTarget(null); }} options={[{ value: "ITEM", label: "A material" }, { value: "GROUP", label: "An item group" }]} />
          <ComboBox label={scope === "ITEM" ? "Material" : "Item group"} selectedKey={target} onSelectionChange={(value) => setTarget(value ? String(value) : null)} options={targets} />
          <Checkbox isSelected={critical} onChange={setCritical}>Critical material (any variance past the warning needs approval)</Checkbox>
          <TextField label="Review above (%)" inputMode="decimal" value={warning} onChange={setWarning} />
          <TextField label="Approval above (%)" inputMode="decimal" value={approval} onChange={setApproval} />
          <TextField label="Check for missing consumption below (−%)" inputMode="decimal" value={saving} onChange={setSaving} description="Empty: the company's." />
          <TextField label="Approval above quantity" inputMode="decimal" value={quantityAbove} onChange={setQuantityAbove} />
          <TextField label="Approval above value (₹)" inputMode="decimal" value={valueAbove} onChange={setValueAbove} description="Empty: the company's." />
        </div>
        <div className="flex justify-end"><Button variant="primary" isLoading={busy} isDisabled={!target || busy} onPress={() => run(() => setTolerance({ scope, itemId: scope === "ITEM" ? target : null,
          itemGroupId: scope === "GROUP" ? target : null, warningPct: warning, approvalPct: approval, savingReviewPct: saving || null, approvalValueAbove: valueAbove || null,
          approvalQuantityAbove: quantityAbove || null, critical }), "Tolerance saved.")}>Save tolerance</Button></div>
      </Panel>
      <Panel title="Tolerances in force">
        {query.data.tolerances.length === 0 ? <p className="text-sm text-text-muted">No overrides: every material uses the company&apos;s tolerance.</p> : (
          <LinesTable columns={["For", { label: "Review above", numeric: true }, { label: "Approval above", numeric: true }, "Thresholds", "Critical", "Version", ""]}>
            {query.data.tolerances.map((row) => (
              <tr key={row.id}>
                <Cell>{row.scope === "GROUP" ? `Group: ${row.label}` : row.label}</Cell><Cell numeric>{row.warningPct}%</Cell><Cell numeric>{row.approvalPct}%</Cell>
                <Cell>{[row.approvalQuantityAbove ? `qty > ${row.approvalQuantityAbove}` : null, row.approvalValueAbove ? `value > ${inr(row.approvalValueAbove)}` : null, row.savingReviewPct ? `saving > ${row.savingReviewPct}%` : null].filter(Boolean).join(" · ") || "—"}</Cell>
                <Cell>{row.critical ? "Critical" : ""}</Cell><Cell>v{row.version} · {formatDateTime(row.updatedAt)}</Cell>
                <Cell><Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => removeTolerance(row.id), "Override removed: the company's tolerance applies.")}>Remove</Button></Cell>
              </tr>
            ))}
          </LinesTable>
        )}
      </Panel>
    </div>
  );
}
