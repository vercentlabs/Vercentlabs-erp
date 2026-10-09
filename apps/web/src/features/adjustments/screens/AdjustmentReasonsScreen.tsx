"use client";

// Stock Adjustment reasons: the system reasons every company starts with, and its own. A reason says whether it adds stock, removes it, or
// both, whether notes are required, and optionally its own gain and loss accounts (otherwise the item's or the company's). Reasons are
// deactivated, never deleted: documents keep them.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Checkbox, Dialog, ErrorState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner } from "@/features/items/item-format";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createReason, errorMessage, listReasons, updateReason, type Reason } from "../api/adjustments-api";

const DIRECTION_LABEL: Record<Reason["directionPolicy"], string> = { increase: "Adds stock", decrease: "Removes stock", both: "Adds or removes" };

export function AdjustmentReasonsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "adjustments", "reasons", "all");
  const reasons = useQuery({ queryKey: key, queryFn: () => listReasons(true) });
  const [editing, setEditing] = useState<Reason | "new" | null>(null);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "adjustments") }); };
  const toggle = useMutation({ mutationFn: (reason: Reason) => updateReason(reason.id, { status: reason.status === "active" ? "inactive" : "active", expectedVersion: reason.version }), onSuccess: refresh });
  if (reasons.isLoading) return <LoadingState label="Loading reasons" rows={4} />;
  if (reasons.isError) return <ErrorState title="Could not load reasons" description={errorMessage(reasons.error)} />;
  return (
    <Panel title="Stock adjustment reasons" description="Why recorded stock was corrected. Consumption, maintenance, returns and transfers are not reasons here: they have their own documents."
      actions={<Button variant="primary" size="compact" onPress={() => setEditing("new")}>New reason</Button>}>
      <ErrorBanner message={toggle.isError ? errorMessage(toggle.error) : null} />
      <LinesTable columns={["Code", "Name", "Direction", "Notes", "Gain account", "Loss account", "Status", ""]} empty={(reasons.data ?? []).length ? undefined : "No reasons yet."}>
        {(reasons.data ?? []).map((reason) => (
          <tr key={reason.id}>
            <Cell><span className="flex flex-wrap items-center gap-1.5 font-mono text-xs">{reason.code}{reason.isSystem && <Badge tone="neutral">System</Badge>}</span></Cell>
            <Cell><span className="flex flex-col">{reason.name}<span className="text-xs text-text-muted">{reason.description}</span></span></Cell>
            <Cell>{DIRECTION_LABEL[reason.directionPolicy]}</Cell>
            <Cell>{reason.requiresNotes ? "Required" : null}</Cell>
            <Cell>{reason.gainAccount ?? "Item or company default"}</Cell>
            <Cell>{reason.lossAccount ?? "Item or company default"}</Cell>
            <Cell><StatusBadge tone={reason.status === "active" ? "success" : "neutral"}>{reason.status === "active" ? "Active" : "Inactive"}</StatusBadge></Cell>
            <Cell><span className="flex gap-1">
              <Button size="compact" variant="ghost" onPress={() => setEditing(reason)}>Edit</Button>
              <Button size="compact" variant="ghost" onPress={() => toggle.mutate(reason)}>{reason.status === "active" ? "Deactivate" : "Activate"}</Button></span></Cell>
          </tr>
        ))}
      </LinesTable>
      {editing && <ReasonDialog reason={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </Panel>
  );
}

function ReasonDialog({ reason, onClose, onDone }: { reason: Reason | null; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(reason?.code ?? "");
  const [name, setName] = useState(reason?.name ?? "");
  const [description, setDescription] = useState(reason?.description ?? "");
  const [direction, setDirection] = useState<Reason["directionPolicy"]>(reason?.directionPolicy ?? "both");
  const [notes, setNotes] = useState(reason?.requiresNotes ?? false);
  const save = useMutation({
    mutationFn: () => reason ? updateReason(reason.id, { name, description, directionPolicy: direction, requiresNotes: notes, expectedVersion: reason.version })
      : createReason({ code, name, description, directionPolicy: direction, requiresNotes: notes }),
    onSuccess: () => { onDone(); onClose(); },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={reason ? `Edit ${reason.name}` : "New stock adjustment reason"}>
      <div className="flex flex-col gap-3">
        {!reason && <TextField label="Code" isRequired value={code} onChange={setCode} description="Letters, digits and underscores, e.g. CYCLE_COUNT_GAIN." />}
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextArea label="Description" value={description} onChange={setDescription} />
        <Select label="Direction" isDisabled={reason?.isSystem} selectedKey={direction} onSelectionChange={(key) => setDirection(String(key) as Reason["directionPolicy"])}
          options={[{ value: "both", label: "Adds or removes stock" }, { value: "increase", label: "Adds stock only" }, { value: "decrease", label: "Removes stock only" }]}
          description={reason?.isSystem ? "A system reason keeps its direction." : undefined} />
        <Checkbox isSelected={notes} onChange={setNotes}>Requires notes explaining the discrepancy</Checkbox>
        <ErrorBanner message={save.isError ? errorMessage(save.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
      </div>
    </Dialog>
  );
}
