"use client";

// Opportunity Close Reasons: the won reasons and the lost reasons, kept
// apart. Administrators add, rename, reorder, activate and deactivate them
// and set each reason's rules. A reason that was used is deactivated, never
// deleted, so closed opportunities keep showing it.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, Dialog, EmptyState, IconButton, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  CLOSE_REASON_CATEGORIES, createCloseReason, deleteCloseReason, errorMessage, listCloseReasons, reorderCloseReasons, setCloseReasonActive, updateCloseReason,
  type CloseOutcome, type CloseReason, type CloseReasonInput,
} from "../api/close-reasons-api";

export function CloseReasonsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.opportunities.manage_close_reasons");
  if (!canManage) return <PermissionState title="You cannot manage won and lost reasons" description="Ask a CRM administrator for access." />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Opportunity Close Reasons" description="Why deals are won and lost. Status says what happened; the reason says why." />
      <Tabs defaultSelectedKey="won">
        <TabList aria-label="Reason kind">
          <Tab id="won">Won Reasons</Tab>
          <Tab id="lost">Lost Reasons</Tab>
        </TabList>
        <TabPanel id="won"><ReasonList outcome="won" /></TabPanel>
        <TabPanel id="lost"><ReasonList outcome="lost" /></TabPanel>
      </Tabs>
    </div>
  );
}

function ReasonList({ outcome }: { outcome: CloseOutcome }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "close-reasons", outcome);
  const query = useQuery({ queryKey: key, queryFn: () => listCloseReasons({ outcome, includeInactive: true }) });
  const [editing, setEditing] = useState<CloseReason | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options") });
  };
  const action = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const reasons = query.data ?? [];
  const active = reasons.filter((reason) => reason.active);
  const move = (index: number, by: number) => {
    const ids = active.map((reason) => reason.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    action.mutate(() => reorderCloseReasons(outcome, ids));
  };
  const rules = (reason: CloseReason) => [
    reason.requiresNotes && "Notes required", reason.requiresCompetitor ? "Competitor required" : reason.capturesCompetitor && "Asks competitor",
    reason.offersFollowUp && "Offers a follow-up", reason.linksDuplicate && "Links the original",
  ].filter(Boolean).join(" · ");

  return (
    <section className="flex flex-col gap-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">{outcome === "won" ? "Shown when marking an opportunity won." : "Shown when marking an opportunity lost."} Keep the list short.</p>
        <Button variant="primary" size="compact" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />Add reason</Button>
      </div>
      {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {query.isLoading ? <LoadingState label="Loading reasons" rows={4} /> : reasons.length === 0 ? <EmptyState title="No reasons yet" /> : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {reasons.map((reason) => {
            const index = active.findIndex((entry) => entry.id === reason.id);
            return (
              <li key={reason.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`font-medium ${reason.active ? "" : "text-text-muted"}`}>{reason.name}</span>
                    {!reason.active && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {[CLOSE_REASON_CATEGORIES.find((entry) => entry.value === reason.category)?.label, rules(reason), reason.useCount ? `Used ${reason.useCount} time${reason.useCount === 1 ? "" : "s"}` : "Not used yet"].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {reason.active && (
                    <>
                      <IconButton aria-label={`Move ${reason.name} up`} size="compact" variant="ghost" isDisabled={index <= 0 || action.isPending} onPress={() => move(index, -1)}><ArrowUp className="size-4" aria-hidden="true" /></IconButton>
                      <IconButton aria-label={`Move ${reason.name} down`} size="compact" variant="ghost" isDisabled={index === active.length - 1 || action.isPending} onPress={() => move(index, 1)}><ArrowDown className="size-4" aria-hidden="true" /></IconButton>
                    </>
                  )}
                  <IconButton aria-label={`Edit ${reason.name}`} size="compact" variant="ghost" onPress={() => setEditing(reason)}><Pencil className="size-4" aria-hidden="true" /></IconButton>
                  <Button variant="ghost" size="compact" isDisabled={action.isPending} onPress={() => action.mutate(() => setCloseReasonActive(reason.id, !reason.active))}>{reason.active ? "Deactivate" : "Activate"}</Button>
                  {!reason.useCount && (
                    <IconButton aria-label={`Delete ${reason.name}`} size="compact" variant="danger" isDisabled={action.isPending} onPress={() => action.mutate(() => deleteCloseReason(reason.id))}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <ReasonDialog outcome={outcome} reason={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </section>
  );
}

function ReasonDialog({ outcome, reason, onClose, onSaved }: { outcome: CloseOutcome; reason: CloseReason | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(reason?.name ?? "");
  const [category, setCategory] = useState(reason?.category ?? "other");
  const [requiresNotes, setRequiresNotes] = useState(reason?.requiresNotes ?? false);
  const [capturesCompetitor, setCapturesCompetitor] = useState(reason?.capturesCompetitor ?? false);
  const [requiresCompetitor, setRequiresCompetitor] = useState(reason?.requiresCompetitor ?? false);
  const [offersFollowUp, setOffersFollowUp] = useState(reason?.offersFollowUp ?? false);
  const [linksDuplicate, setLinksDuplicate] = useState(reason?.linksDuplicate ?? false);
  const input: CloseReasonInput = { name: name.trim(), category, requiresNotes, capturesCompetitor: capturesCompetitor || requiresCompetitor, requiresCompetitor, offersFollowUp, linksDuplicate };
  const save = useMutation({ mutationFn: () => (reason ? updateCloseReason(reason.id, input) : createCloseReason({ ...input, outcome })), onSuccess: onSaved });
  const lost = outcome === "lost";
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={reason ? "Edit reason" : `Add a ${outcome} reason`}
      description={reason ? "Renaming keeps the reason's history: closed opportunities show the new name." : undefined}>
      <div className="flex flex-col gap-4">
        {save.isError && <p role="alert" className="text-sm text-danger">{errorMessage(save.error, "The reason could not be saved.")}</p>}
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Category" description="Groups reasons in reports." selectedKey={category} onSelectionChange={(key) => setCategory(String(key))} options={CLOSE_REASON_CATEGORIES} />
        <div className="flex flex-col gap-2">
          <Checkbox isSelected={requiresNotes} onChange={setRequiresNotes}>Notes required</Checkbox>
          <Checkbox isSelected={capturesCompetitor || requiresCompetitor} onChange={(value) => { setCapturesCompetitor(value); if (!value) setRequiresCompetitor(false); }}>Ask for the competitor</Checkbox>
          <Checkbox isSelected={requiresCompetitor} onChange={setRequiresCompetitor}>Competitor required</Checkbox>
          {lost && <Checkbox isSelected={offersFollowUp} onChange={setOffersFollowUp}>Offer a future follow-up (the deal may come back)</Checkbox>}
          {lost && <Checkbox isSelected={linksDuplicate} onChange={setLinksDuplicate}>Ask for the original opportunity (duplicates)</Checkbox>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!name.trim()} onPress={() => save.mutate()}>{reason ? "Save" : "Add reason"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
