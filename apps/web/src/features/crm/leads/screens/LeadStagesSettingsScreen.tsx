"use client";

// The organization's lead stages: rename, reorder (drag, or the arrows), add and deactivate, with a preview of the stage track a lead page
// shows. The
// five standard stages always exist; the stages a lead's status moves
// through (open, qualified, disqualified, converted) are fixed and are not
// configured here. Needs the Manage lead stages permission (or Manage CRM
// settings).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Badge, Button, Dialog, ErrorState, PageHeader, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createLeadStage, errorMessage, listLeadStages, reorderLeadStages, updateLeadStage, type LeadStageDefinition } from "../api/leads-api";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";

import { ErrorBanner } from "../lead-format";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";

export function LeadStagesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.leadsManageStages) || workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);
  const key = scopedQueryKey(workspace, "crm", "lead-stages");
  const query = useQuery({ queryKey: key, queryFn: () => listLeadStages(true), enabled: canManage });
  const [editing, setEditing] = useState<LeadStageDefinition | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-options") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
  };
  const change = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: refresh,
    onError: (failure) => setError(errorMessage(failure)),
  });

  if (!canManage) return <PermissionState title="You don't have access to lead stages" description="Ask an administrator for the Manage lead stages permission." />;
  if (query.isLoading) return <LoadingState label="Loading lead stages" rows={5} />;
  if (query.isError) return <ErrorState title="Could not load the lead stages" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;

  const stages = query.data ?? [];
  const move = (index: number, offset: number) => {
    const ids = stages.map((stage) => stage.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    change.mutate(() => reorderLeadStages(ids));
  };
  // A stage dropped onto another takes its place; the rest shift.
  const drop = (target: number) => {
    if (dragged === null || dragged === target) return setDragged(null);
    const ids = stages.map((stage) => stage.id);
    const [moved] = ids.splice(dragged, 1);
    ids.splice(target, 0, moved);
    setDragged(null);
    change.mutate(() => reorderLeadStages(ids));
  };
  const track = stages.filter((stage) => stage.isActive);

  // New and Qualification are always kept; any other stage may be switched off for a simpler funnel.
  const fixed = (stage: LeadStageDefinition) => ["new", "qualification"].includes(stage.code);
  const toggleActive = (stage: LeadStageDefinition) => change.mutate(() => updateLeadStage(stage.id, { isActive: !stage.isActive }));

  // Desktop: the stages on the left, the preview and the rules on the right. Tablet and phone: one column, the stages first.
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader
        title="Lead stages"
        description="The steps a lead moves through while it is being worked. A lead can move forwards or backwards between them while it is open."
        primaryAction={<Button variant="primary" className="w-full sm:w-auto" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New stage</Button>}
      />
      <ErrorBanner message={error} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <section aria-labelledby="stage-list" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <h2 id="stage-list" className="text-sm font-semibold text-text">{`${track.length} active stage${track.length === 1 ? "" : "s"}`}</h2>
            <p className="hidden text-xs text-text-muted sm:block">Drag a stage to reorder it, or use Up and Down.</p>
          </div>
          <ol className="flex flex-col divide-y divide-border">
            {stages.map((stage, index) => (
              <li key={stage.id} draggable={!change.isPending} onDragStart={() => setDragged(index)} onDragEnd={() => setDragged(null)}
                onDragOver={(event) => event.preventDefault()} onDrop={() => drop(index)}
                className={`flex items-center gap-3 px-4 py-3 sm:cursor-grab ${dragged === index ? "opacity-50" : ""} ${stage.isActive ? "" : "bg-surface-muted"}`}>
                <span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${stage.isActive ? "border-brand/40 text-brand" : "border-border text-text-muted"}`}>{index + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-medium ${stage.isActive ? "text-text" : "text-text-muted"}`}>{stage.name}</span>
                    {stage.isSystem && <Badge tone="neutral">Standard</Badge>}
                    {!stage.isActive && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                    {stage.staleAfterDays ? <Badge tone="warning">{`Stale after ${stage.staleAfterDays} ${stage.staleAfterDays === 1 ? "day" : "days"}`}</Badge> : null}
                  </div>
                  <span className="text-xs text-text-muted">{`${stage.leadCount ?? 0} open ${stage.leadCount === 1 ? "lead" : "leads"}`}{fixed(stage) ? " · always on" : ""}</span>
                </div>
                {/* On a phone the actions sit in a menu so each stage stays one compact row. */}
                <div className="shrink-0 sm:hidden">
                  <MoreMenu label={`Actions for ${stage.name}`} items={[
                    { id: "up", label: "Move up", isDisabled: index === 0 || change.isPending, onAction: () => move(index, -1) },
                    { id: "down", label: "Move down", isDisabled: index === stages.length - 1 || change.isPending, onAction: () => move(index, 1) },
                    { id: "rename", label: "Edit", onAction: () => setEditing(stage) },
                    ...(!fixed(stage) ? [{ id: "active", label: stage.isActive ? "Deactivate" : "Activate", isDisabled: change.isPending, onAction: () => toggleActive(stage) }] : []),
                  ]} />
                </div>
                {/* Tablet and desktop: the same four places in every row, so the buttons line up; a stage that is always on keeps the last place empty. */}
                <div className="hidden shrink-0 items-center gap-1 sm:grid sm:grid-cols-[auto_auto_auto_6.5rem]">
                  <Button variant="ghost" size="compact" aria-label={`Move ${stage.name} up`} isDisabled={index === 0 || change.isPending} onPress={() => move(index, -1)}>
                    <ArrowUp className="size-4" aria-hidden="true" />Up
                  </Button>
                  <Button variant="ghost" size="compact" aria-label={`Move ${stage.name} down`} isDisabled={index === stages.length - 1 || change.isPending} onPress={() => move(index, 1)}>
                    <ArrowDown className="size-4" aria-hidden="true" />Down
                  </Button>
                  <Button variant="ghost" size="compact" onPress={() => setEditing(stage)}>Edit</Button>
                  {fixed(stage) ? <span aria-hidden="true" /> : (
                    <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => toggleActive(stage)}>{stage.isActive ? "Deactivate" : "Activate"}</Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex flex-col gap-4">
          {track.length > 0 && (
            <section aria-labelledby="stage-preview" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <div className="flex flex-col gap-0.5">
                <h2 id="stage-preview" className="text-sm font-semibold text-text">Preview</h2>
                <p className="text-xs text-text-muted">How a lead page shows the stages, for a lead in the second stage.</p>
              </div>
              {/* A track that reads down the panel: done, current (with its days), then the stages still ahead. */}
              <ol className="flex flex-col gap-2 text-sm">
                {track.map((stage, index) => (
                  <li key={stage.id} className="flex items-center gap-2">
                    <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${index < 1 ? "border-text-muted text-text" : index === 1 ? "border-brand bg-brand text-white" : "border-border text-text-muted"}`}>
                      {index < 1 ? "✓" : index === 1 ? "●" : ""}
                    </span>
                    <span className={index === 1 ? "font-semibold text-brand" : index < 1 ? "text-text" : "text-text-muted"}>{stage.name}</span>
                    {index === 1 && <span className="text-xs text-text-muted">3 days</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <section aria-labelledby="stage-rules" className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <h2 id="stage-rules" className="text-sm font-semibold text-text">How stages work</h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-secondary">
              <li>Standard stages can be renamed and reordered but not removed.</li>
              <li>New and Qualification are always on: starting qualification moves a lead to Qualification, whatever you call it.</li>
              <li>A stage that is switched off keeps its history.</li>
              <li>Proposal, negotiation and won or lost belong to deals, not leads.</li>
            </ul>
          </section>
        </div>
      </div>
      {editing && <StageDialog stage={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function StageDialog({ stage, onClose, onSaved }: { stage: LeadStageDefinition | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(stage?.name ?? "");
  const [staleDays, setStaleDays] = useState(stage?.staleAfterDays ? String(stage.staleAfterDays) : "");
  const [error, setError] = useState<string | null>(null);
  const days = staleDays.trim() === "" ? null : Number(staleDays);
  const daysValid = days === null || (Number.isInteger(days) && days >= 1 && days <= 365);
  const mutation = useMutation({
    mutationFn: async () => {
      if (stage) return updateLeadStage(stage.id, { name, staleAfterDays: days });
      const created = await createLeadStage(name);
      return days === null ? created : updateLeadStage(created.stage.id, { staleAfterDays: days });
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={stage ? "Edit stage" : "New stage"}
      description={stage ? "Leads in this stage and its history show the new name." : "The new stage is added at the end; move it to where it belongs."}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextField label="Stage name" isRequired value={name} onChange={(value) => { setName(value); setError(null); }} />
        <TextField label="Stale after (days)" inputMode="numeric" description="Days without activity before an open lead in this stage is shown as stale. Empty: the standard 7."
          value={staleDays} onChange={setStaleDays} isInvalid={!daysValid} errorMessage={daysValid ? undefined : "Enter 1 to 365, or leave it empty."} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" className="w-full sm:w-auto" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim() || !daysValid}>{stage ? "Save" : "Add stage"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
