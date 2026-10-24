"use client";

// Won and lost reasons: the won reasons and the lost reasons, kept apart as two tabs. Administrators add, rename, reorder, activate and
// deactivate them and set each reason's rules. A reason that was used, or a standard one, is deactivated, never deleted, so closed
// deals keep showing it. Desktop: the list with how reasons work beside it. Tablet and phone: one column, the list first.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { AlertDialog, Badge, Button, Checkbox, Dialog, ErrorState, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextField } from "@vercentlabs/design-system";

import { ErrorBanner } from "@/features/crm/opportunities/opportunity-format";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  CLOSE_REASON_CATEGORIES, createCloseReason, deleteCloseReason, errorMessage, listCloseReasons, reorderCloseReasons, setCloseReasonActive, updateCloseReason,
  type CloseOutcome, type CloseReason, type CloseReasonInput,
} from "../api/close-reasons-api";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
// The standard Other reasons always ask for an explanation; the server keeps that on.
const ALWAYS_NOTES = new Set(["other", "won_other"]);

export function CloseReasonsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.opportunities.manage_close_reasons");
  const key = scopedQueryKey(workspace, "crm", "close-reasons");
  const query = useQuery({ queryKey: key, queryFn: () => listCloseReasons({ includeInactive: true }), enabled: canManage });
  const [tab, setTab] = useState<CloseOutcome>("won");
  const [editing, setEditing] = useState<{ outcome: CloseOutcome; reason: CloseReason | null } | null>(null);
  const [deleting, setDeleting] = useState<CloseReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options") });
  };
  const change = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => { setDeleting(null); refresh(); },
    onError: (failure) => { setDeleting(null); setError(errorMessage(failure)); },
  });

  if (!canManage) return <PermissionState title="You cannot manage won and lost reasons" description="Ask a CRM administrator for access." />;
  const reasons = query.data ?? [];
  const of = (outcome: CloseOutcome) => reasons.filter((reason) => reason.outcome === outcome);
  const activeCount = (outcome: CloseOutcome) => of(outcome).filter((reason) => reason.active).length;

  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader
        title="Won and lost reasons"
        description="Why deals are won and lost. Status says what happened; the reason says why, and each reason decides what the Mark won and Mark lost dialogs ask for."
        primaryAction={
          <Button variant="primary" className="flex-1 sm:flex-none" onPress={() => setEditing({ outcome: tab, reason: null })}>
            <Plus className="size-4" aria-hidden="true" />{tab === "won" ? "Add won reason" : "Add lost reason"}
          </Button>
        }
      />
      <ErrorBanner message={error} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="min-w-0">
          {query.isLoading ? <LoadingState label="Loading reasons" rows={6} />
            : query.isError ? <ErrorState title="Reasons could not be loaded" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />
            : (
              <Tabs selectedKey={tab} onSelectionChange={(next) => setTab(next === "lost" ? "lost" : "won")}>
                <TabList aria-label="Reason kind">
                  <Tab id="won">{`Won reasons (${activeCount("won")})`}</Tab>
                  <Tab id="lost">{`Lost reasons (${activeCount("lost")})`}</Tab>
                </TabList>
                {(["won", "lost"] as const).map((outcome) => (
                  <TabPanel key={outcome} id={outcome}>
                    <ReasonLists outcome={outcome} reasons={of(outcome)} busy={change.isPending}
                      onReorder={(ids) => change.mutate(() => reorderCloseReasons(outcome, ids))}
                      onEdit={(reason) => setEditing({ outcome, reason })}
                      onSetActive={(reason, active) => change.mutate(() => setCloseReasonActive(reason.id, active))}
                      onDelete={setDeleting} />
                  </TabPanel>
                ))}
              </Tabs>
            )}
        </div>

        <section aria-labelledby="reasons-how" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 id="reasons-how" className="text-sm font-semibold text-text">How reasons work</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            <li>Mark won and Mark lost show the active reasons of that kind, in this order. Keep each list short so the choice is quick.</li>
            <li>A reason can ask for an explanation or the competitor, and make either one required. A lost reason can also offer a future follow-up, or ask for the original deal when it is a duplicate.</li>
            <li>The category groups reasons in the win and loss report.</li>
            <li>Renaming a reason keeps its history: closed deals show the new name.</li>
            <li>A reason that was used, or a standard one, is never deleted, only deactivated, so closed deals keep showing it. Only a reason you added and never used can be deleted.</li>
            <li>Each kind keeps at least one active reason.</li>
          </ul>
        </section>
      </div>

      {editing && (
        <ReasonDialog outcome={editing.outcome} reason={editing.reason} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }} />
      )}
      <AlertDialog isOpen={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title={`Delete "${deleting?.name ?? ""}"?`}
        description="The reason is removed for good. It was never used, so no deal loses it. To keep it for later, deactivate it instead."
        confirmLabel="Delete reason" isConfirming={change.isPending} onConfirm={() => deleting && change.mutate(() => deleteCloseReason(deleting.id))} />
    </div>
  );
}

type ListProps = {
  outcome: CloseOutcome; reasons: CloseReason[]; busy: boolean;
  onReorder: (ids: string[]) => void; onEdit: (reason: CloseReason) => void; onSetActive: (reason: CloseReason, active: boolean) => void; onDelete: (reason: CloseReason) => void;
};

function ReasonLists({ outcome, reasons, busy, onReorder, onEdit, onSetActive, onDelete }: ListProps) {
  const active = reasons.filter((reason) => reason.active);
  const inactive = reasons.filter((reason) => !reason.active);
  const move = (index: number, by: number) => {
    const ids = active.map((reason) => reason.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    onReorder(ids);
  };

  const row = (reason: CloseReason) => {
    const index = active.findIndex((entry) => entry.id === reason.id);
    const lastActive = reason.active && active.length === 1;
    const deletable = !reason.useCount && !reason.isStandard;
    const category = CLOSE_REASON_CATEGORIES.find((entry) => entry.value === reason.category)?.label;
    const asks = [
      reason.requiresNotes && "Explanation required",
      reason.requiresCompetitor ? "Competitor required" : reason.capturesCompetitor && "Asks for the competitor",
      reason.offersFollowUp && "Offers a follow-up",
      reason.linksDuplicate && "Asks for the original deal",
    ].filter((entry): entry is string => Boolean(entry));
    return (
      <li key={reason.id} className={`flex items-start gap-3 px-4 py-3.5 ${reason.active ? "" : "bg-surface-muted"}`}>
        <span aria-hidden="true" className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${reason.active ? "border-brand/40 text-brand" : "border-border text-text-muted"}`}>
          {reason.active ? index + 1 : "–"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-medium ${reason.active ? "text-text" : "text-text-muted"}`}>{reason.name}</span>
            {category && <Badge tone="neutral">{category}</Badge>}
            {reason.isStandard && <Badge tone="neutral">Standard</Badge>}
            {!reason.active && <StatusBadge tone="neutral">Inactive</StatusBadge>}
          </div>
          {asks.length > 0 && <span className="text-xs text-text"><span className="font-medium">Asks:</span> {asks.join(", ")}</span>}
          <span className="text-xs text-text-muted">{reason.useCount ? `Used on ${plural(reason.useCount, "closed deal")}` : "Not used yet"}</span>
        </div>
        {/* On a phone the actions sit in a menu so each reason stays one compact row. */}
        <div className="shrink-0 sm:hidden">
          <MoreMenu label={`Actions for ${reason.name}`} items={[
            ...(reason.active ? [
              { id: "up", label: "Move up", isDisabled: index === 0 || busy, onAction: () => move(index, -1) },
              { id: "down", label: "Move down", isDisabled: index === active.length - 1 || busy, onAction: () => move(index, 1) },
            ] : []),
            { id: "edit", label: "Edit", onAction: () => onEdit(reason) },
            { id: "active", label: reason.active ? "Deactivate" : "Activate", isDisabled: busy || lastActive, onAction: () => onSetActive(reason, !reason.active) },
            ...(deletable ? [{ id: "delete", label: "Delete", danger: true, isDisabled: busy, onAction: () => onDelete(reason) }] : []),
          ]} />
        </div>
        {/* Tablet and desktop: the same places in every row, so the buttons line up; words on every button. */}
        <div className="hidden shrink-0 items-center gap-1 sm:grid sm:grid-cols-[auto_auto_auto_6.5rem_4.5rem]">
          {reason.active ? (
            <>
              <Button variant="ghost" size="compact" aria-label={`Move ${reason.name} up`} isDisabled={index === 0 || busy} onPress={() => move(index, -1)}>
                <ArrowUp className="size-4" aria-hidden="true" />Up
              </Button>
              <Button variant="ghost" size="compact" aria-label={`Move ${reason.name} down`} isDisabled={index === active.length - 1 || busy} onPress={() => move(index, 1)}>
                <ArrowDown className="size-4" aria-hidden="true" />Down
              </Button>
            </>
          ) : <><span aria-hidden="true" /><span aria-hidden="true" /></>}
          <Button variant="ghost" size="compact" aria-label={`Edit ${reason.name}`} onPress={() => onEdit(reason)}>Edit</Button>
          <Button variant="ghost" size="compact" aria-label={`${reason.active ? "Deactivate" : "Activate"} ${reason.name}`} isDisabled={busy || lastActive}
            onPress={() => onSetActive(reason, !reason.active)}>{reason.active ? "Deactivate" : "Activate"}</Button>
          {deletable
            ? <Button variant="ghost" size="compact" className="text-danger" aria-label={`Delete ${reason.name}`} isDisabled={busy} onPress={() => onDelete(reason)}>Delete</Button>
            : <span aria-hidden="true" />}
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
      <section aria-labelledby={`${outcome}-active`} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
          <h2 id={`${outcome}-active`} className="text-sm font-semibold text-text">{`${plural(active.length, "active reason")}`}</h2>
          <span className="text-xs text-text-muted">{outcome === "won" ? "Offered when a deal is marked won, in this order." : "Offered when a deal is marked lost, in this order."}</span>
        </div>
        {active.length === 0 ? <p className="px-4 py-6 text-sm text-text-secondary">No active reasons. Add one, or activate one below.</p>
          : <ol className="flex flex-col divide-y divide-border">{active.map(row)}</ol>}
      </section>
      {inactive.length > 0 && (
        <section aria-labelledby={`${outcome}-inactive`} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <h2 id={`${outcome}-inactive`} className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{`Inactive reasons (${inactive.length})`}</h2>
          <ul className="flex flex-col divide-y divide-border">{inactive.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

function ReasonDialog({ outcome, reason, onClose, onSaved }: { outcome: CloseOutcome; reason: CloseReason | null; onClose: () => void; onSaved: () => void }) {
  const notesLocked = Boolean(reason && ALWAYS_NOTES.has(reason.code));
  const [name, setName] = useState(reason?.name ?? "");
  const [category, setCategory] = useState(reason?.category ?? "other");
  const [requiresNotes, setRequiresNotes] = useState(reason?.requiresNotes ?? false);
  const [capturesCompetitor, setCapturesCompetitor] = useState(reason?.capturesCompetitor ?? false);
  const [requiresCompetitor, setRequiresCompetitor] = useState(reason?.requiresCompetitor ?? false);
  const [offersFollowUp, setOffersFollowUp] = useState(reason?.offersFollowUp ?? false);
  const [linksDuplicate, setLinksDuplicate] = useState(reason?.linksDuplicate ?? false);
  const lost = outcome === "lost";
  const input: CloseReasonInput = {
    name: name.trim(), category, requiresNotes: requiresNotes || notesLocked, capturesCompetitor: capturesCompetitor || requiresCompetitor, requiresCompetitor,
    offersFollowUp: lost && offersFollowUp, linksDuplicate: lost && linksDuplicate,
  };
  const save = useMutation({ mutationFn: () => (reason ? updateCloseReason(reason.id, input) : createCloseReason({ ...input, outcome })), onSuccess: onSaved });
  const nameTooLong = name.trim().length > 120;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={reason ? `Edit "${reason.name}"` : `Add a ${outcome} reason`}
      description={reason ? "Renaming keeps the reason's history: closed deals show the new name." : `Offered when a deal is marked ${outcome}, at the end of the list.`}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (name.trim() && !nameTooLong) save.mutate(); }}>
        {save.isError && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{errorMessage(save.error, "The reason could not be saved.")}</p>}
        <TextField label="Name" isRequired autoFocus value={name} onChange={setName} isInvalid={nameTooLong} errorMessage={nameTooLong ? "Use 120 characters or fewer." : undefined} />
        <Select label="Category" description="Groups reasons in the win and loss report." selectedKey={category} onSelectionChange={(key) => setCategory(String(key))} options={CLOSE_REASON_CATEGORIES} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-text">{`When a deal is marked ${outcome} with this reason`}</legend>
          <Checkbox isSelected={requiresNotes || notesLocked} isDisabled={notesLocked} onChange={setRequiresNotes}>
            {notesLocked ? "Ask for an explanation (always on for Other)" : "Ask for an explanation, and require it"}
          </Checkbox>
          <Checkbox isSelected={capturesCompetitor || requiresCompetitor} onChange={(value) => { setCapturesCompetitor(value); if (!value) setRequiresCompetitor(false); }}>
            {lost ? "Ask which competitor the customer chose" : "Ask which competitor the deal was won against"}
          </Checkbox>
          <div className="pl-6">
            <Checkbox isSelected={requiresCompetitor} isDisabled={!(capturesCompetitor || requiresCompetitor)} onChange={setRequiresCompetitor}>Require the competitor</Checkbox>
          </div>
          {lost && <Checkbox isSelected={offersFollowUp} onChange={setOffersFollowUp}>Offer a future follow-up (the deal may come back)</Checkbox>}
          {lost && <Checkbox isSelected={linksDuplicate} onChange={setLinksDuplicate}>Ask for the original deal (for duplicates)</Checkbox>}
        </fieldset>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!name.trim() || nameTooLong}>
            {reason ? "Save reason" : "Add reason"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
