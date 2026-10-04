"use client";

// The organization's sales stages: name, description, guidance, order,
// default probability, and whether a stage is in use. There is one sales
// pipeline. Won and Lost are outcomes reached through Mark won and Mark lost,
// so they are not listed here. Needs the Configure pipeline stages
// permission (or Manage CRM settings).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Badge, Button, Dialog, ErrorState, LinkButton, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ErrorBanner } from "@/features/crm/opportunities/opportunity-format";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createSalesStage, errorMessage, listSalesStages, reorderSalesStages, stageInUseCount, updateSalesStage, type SalesStage } from "../api/sales-stages-api";

export function SalesStagesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner")
    || workspace.permissions.includes(CRM_PERMISSIONS.pipelineManageStages) || workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);
  const key = scopedQueryKey(workspace, "crm", "sales-stage-settings");
  const query = useQuery({ queryKey: key, queryFn: listSalesStages, enabled: canManage });
  const [editing, setEditing] = useState<SalesStage | "new" | null>(null);
  const [deactivating, setDeactivating] = useState<{ stage: SalesStage; openCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
  };
  const change = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  // A stage with open opportunities in it needs to know where they go.
  const setActive = useMutation({
    mutationFn: ({ stage, isActive }: { stage: SalesStage; isActive: boolean }) => updateSalesStage(stage.id, { isActive }),
    onSuccess: refresh,
    onError: (failure, { stage }) => {
      const openCount = stageInUseCount(failure);
      if (openCount === null) setError(errorMessage(failure));
      else setDeactivating({ stage, openCount });
    },
  });

  if (!canManage) return <PermissionState title="You don't have access to the sales stages" description="Ask an administrator for the Configure pipeline stages permission." />;
  if (query.isLoading) return <LoadingState label="Loading sales stages" rows={5} />;
  if (query.isError) return <ErrorState title="Could not load the sales stages" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;

  const stages = query.data ?? [];
  const active = stages.filter((stage) => stage.isActive);
  const busy = change.isPending || setActive.isPending;
  const move = (index: number, offset: number) => {
    const ids = active.map((stage) => stage.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    change.mutate(() => reorderSalesStages(ids));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sales stages"
        description="The steps an opportunity moves through while it is open. They are the columns of the pipeline, and each gives a deal its default probability."
        primaryAction={<Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New stage</Button>}
        secondaryActions={<LinkButton variant="outline" href="/crm/pipeline">Open pipeline</LinkButton>}
      />
      <ErrorBanner message={error} />
      <ol className="flex max-w-4xl flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {stages.map((stage) => {
          const index = active.findIndex((entry) => entry.id === stage.id);
          return (
            <li key={stage.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{stage.isActive ? `${index + 1}. ` : ""}{stage.name}</span>
                  <Badge tone="brand">{stage.probability}%</Badge>
                  {stage.isStandard && <Badge tone="neutral">Standard</Badge>}
                  {!stage.isActive && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                </div>
                {stage.description && <span className="text-text-secondary">{stage.description}</span>}
                <span className="text-xs text-text-muted">
                  {stage.isActive ? `Sequence ${stage.sequence} · ` : ""}{stage.openCount} open {stage.openCount === 1 ? "opportunity" : "opportunities"} in this stage
                </span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {stage.isActive && (
                  <>
                    <Button variant="ghost" size="compact" aria-label={`Move ${stage.name} earlier`} isDisabled={index === 0 || busy} onPress={() => move(index, -1)}><ArrowUp className="size-4" aria-hidden="true" /></Button>
                    <Button variant="ghost" size="compact" aria-label={`Move ${stage.name} later`} isDisabled={index === active.length - 1 || busy} onPress={() => move(index, 1)}><ArrowDown className="size-4" aria-hidden="true" /></Button>
                  </>
                )}
                <Button variant="ghost" size="compact" onPress={() => setEditing(stage)}>Edit</Button>
                <Button variant="ghost" size="compact" isDisabled={busy} onPress={() => setActive.mutate({ stage, isActive: !stage.isActive })}>{stage.isActive ? "Deactivate" : "Activate"}</Button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex max-w-4xl flex-col gap-2 text-sm text-text-secondary">
        <p>Changing the order changes how the pipeline is displayed. It does not move any opportunity or rewrite its stage history. Renaming a stage keeps every opportunity and its history attached to it.</p>
        <p>A stage is never deleted, only deactivated, so the history of deals that passed through it stays readable. Changing a stage&apos;s probability updates the open deals in it, except those whose probability was set by hand.</p>
        <p>Two checks follow the standard stages whatever you call them: a deal needs a primary contact and an estimated value to enter Proposal, and an expected close date to enter Closing. Won and Lost are outcomes, set with Mark won and Mark lost, not stages.</p>
      </div>
      {editing && <StageDialog stage={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {deactivating && (
        <DeactivateDialog stage={deactivating.stage} openCount={deactivating.openCount} targets={active.filter((stage) => stage.id !== deactivating.stage.id)}
          onClose={() => setDeactivating(null)} onDone={refresh} />
      )}
    </div>
  );
}

function StageDialog({ stage, onClose, onSaved }: { stage: SalesStage | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(stage?.name ?? "");
  const [probability, setProbability] = useState(stage ? String(stage.probability) : "");
  const [description, setDescription] = useState(stage?.description ?? "");
  const [guidance, setGuidance] = useState(stage?.guidance ?? "");
  const [error, setError] = useState<string | null>(null);
  const value = Number(probability);
  const valid = Boolean(name.trim()) && probability.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100;
  const mutation = useMutation({
    mutationFn: () => {
      const input = { name, probability: value, description, guidance };
      return stage ? updateSalesStage(stage.id, input) : createSalesStage(input);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={stage ? "Edit stage" : "New stage"} size="lg"
      description={stage ? "Opportunities in this stage and its history show the new name." : "The new stage is added after the last one; move it to where it belongs."}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <TextField label="Stage name" isRequired value={name} onChange={(next) => { setName(next); setError(null); }} />
          <TextField label="Default probability (%)" isRequired inputMode="numeric" value={probability} onChange={(next) => { setProbability(next); setError(null); }} />
        </div>
        <TextArea label="Description" description="One or two lines: when does a deal belong in this stage? Shown to everyone working opportunities." value={description} onChange={setDescription} />
        <TextArea label="Guidance" description="The goals of the stage, one per line." value={guidance} onChange={setGuidance} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!valid}>{stage ? "Save" : "Add stage"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function DeactivateDialog({ stage, openCount, targets, onClose, onDone }: { stage: SalesStage; openCount: number; targets: SalesStage[]; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => updateSalesStage(stage.id, { isActive: false, moveOpenTo: target }),
    onSuccess: () => { onDone(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Deactivate ${stage.name}`}
      description={`${openCount} open ${openCount === 1 ? "opportunity currently uses" : "opportunities currently use"} this stage. Choose the stage to move ${openCount === 1 ? "it" : "them"} to; each move is recorded in the opportunity's stage history.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Move the open opportunities to" isRequired selectedKey={target} onSelectionChange={(key) => setTarget(String(key ?? ""))}
          options={targets.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.probability}%` }))} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="danger" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!target}>Move and deactivate</Button>
        </div>
      </div>
    </Dialog>
  );
}
