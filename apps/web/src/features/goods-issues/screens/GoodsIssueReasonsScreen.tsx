"use client";

// Goods Issue reasons: the system reasons every company starts with, and its own. A reason says which stock it may issue (available only, or
// held, damaged and expired stock too — disposal), whether a recipient or notes are required, and optionally its expense account. Reasons are
// deactivated, never deleted: documents keep them.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Checkbox, Dialog, ErrorState, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner } from "@/features/items/item-format";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { DISPOSITION_LABEL, createReason, errorMessage, listReasons, updateReason, type Disposition, type Reason } from "../api/goods-issues-api";

const ALL: Disposition[] = ["available", "quality_hold", "quarantined", "damaged", "expired"];

export function GoodsIssueReasonsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "goods-issues", "reasons", "all");
  const reasons = useQuery({ queryKey: key, queryFn: () => listReasons(true) });
  const [editing, setEditing] = useState<Reason | "new" | null>(null);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "goods-issues") }); };
  const toggle = useMutation({ mutationFn: (reason: Reason) => updateReason(reason.id, { status: reason.status === "active" ? "inactive" : "active", expectedVersion: reason.version }), onSuccess: refresh });
  if (reasons.isLoading) return <LoadingState label="Loading reasons" rows={4} />;
  if (reasons.isError) return <ErrorState title="Could not load reasons" description={errorMessage(reasons.error)} />;
  return (
    <Panel title="Goods issue reasons" description="Why stock is issued, and which stock each reason may take. Reasons in use are deactivated, never deleted."
      actions={<Button variant="primary" size="compact" onPress={() => setEditing("new")}>New reason</Button>}>
      <ErrorBanner message={toggle.isError ? errorMessage(toggle.error) : null} />
      <LinesTable columns={["Code", "Name", "May issue", "Requires", "Expense account", "Status", ""]} empty={(reasons.data ?? []).length ? undefined : "No reasons yet."}>
        {(reasons.data ?? []).map((reason) => (
          <tr key={reason.id}>
            <Cell><span className="flex flex-wrap items-center gap-1.5 font-mono text-xs">{reason.code}{reason.isSystem && <Badge tone="neutral">System</Badge>}</span></Cell>
            <Cell><span className="flex flex-col">{reason.name}<span className="text-xs text-text-muted">{reason.description}</span></span></Cell>
            <Cell>{reason.allowedDispositions.map((entry) => DISPOSITION_LABEL[entry]).join(", ")}</Cell>
            <Cell>{[reason.requiresRecipient && "Recipient", reason.requiresNotes && "Notes"].filter(Boolean).join(", ")}</Cell>
            <Cell>{reason.expenseAccount ?? (reason.isDisposal ? "Company write-off" : "Company expense")}</Cell>
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
  const [allowed, setAllowed] = useState<Disposition[]>(reason?.allowedDispositions ?? ["available"]);
  const [recipient, setRecipient] = useState(reason?.requiresRecipient ?? false);
  const [notes, setNotes] = useState(reason?.requiresNotes ?? false);
  const save = useMutation({
    mutationFn: () => reason ? updateReason(reason.id, { name, description, allowedDispositions: allowed, requiresRecipient: recipient, requiresNotes: notes, expectedVersion: reason.version })
      : createReason({ code, name, description, allowedDispositions: allowed, requiresRecipient: recipient, requiresNotes: notes }),
    onSuccess: () => { onDone(); onClose(); },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={reason ? `Edit ${reason.name}` : "New goods issue reason"}>
      <div className="flex flex-col gap-3">
        {!reason && <TextField label="Code" isRequired value={code} onChange={setCode} description="Letters, digits and underscores, e.g. TRAINING_USE." />}
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextArea label="Description" value={description} onChange={setDescription} />
        <div className="flex flex-col gap-1"><span className="text-sm font-medium">May issue</span>
          {ALL.map((entry) => <Checkbox key={entry} isSelected={allowed.includes(entry)} onChange={(selected) => setAllowed((current) => selected ? [...current, entry] : current.filter((value) => value !== entry))}>{DISPOSITION_LABEL[entry]}</Checkbox>)}</div>
        <Checkbox isSelected={recipient} onChange={setRecipient}>Requires who or what the goods went to</Checkbox>
        <Checkbox isSelected={notes} onChange={setNotes}>Requires notes</Checkbox>
        <ErrorBanner message={save.isError ? errorMessage(save.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
      </div>
    </Dialog>
  );
}
