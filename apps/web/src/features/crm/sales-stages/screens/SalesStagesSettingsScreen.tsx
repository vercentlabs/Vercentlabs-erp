"use client";

// The organization's pipelines and their sales stages (CRM plan 5.1). Each pipeline has its own stages — name, description, guidance,
// order, default probability, what a deal needs to enter (required, or only a warning) and how long it should stay — and may belong to
// a sales team, whose new deals start in it. One pipeline is the default. Won and Lost are outcomes reached through Mark won and Mark
// lost, so they are not listed here. Needs the Configure pipeline stages permission (or Manage CRM settings).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Badge, Button, Dialog, ErrorState, LinkButton, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ErrorBanner } from "@/features/crm/opportunities/opportunity-format";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  STAGE_RULE_LABELS, createPipeline, createSalesStage, errorMessage, listPipelines, listSalesStages, reorderSalesStages, stageInUseCount, updatePipeline,
  updateSalesStage, type Pipeline, type SalesStage, type StageRule, type StageRuleKey,
} from "../api/sales-stages-api";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";

export function SalesStagesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner")
    || workspace.permissions.includes(CRM_PERMISSIONS.pipelineManageStages) || workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);
  const pipelinesKey = scopedQueryKey(workspace, "crm", "pipeline-settings");
  const pipelines = useQuery({ queryKey: pipelinesKey, queryFn: () => listPipelines(true), enabled: canManage });
  const [chosen, setChosen] = useState<string | null>(null);
  const pipeline = (pipelines.data ?? []).find((entry) => entry.id === chosen) ?? (pipelines.data ?? []).find((entry) => entry.isDefault) ?? null;
  const key = scopedQueryKey(workspace, "crm", "sales-stage-settings", pipeline?.id ?? "default");
  const query = useQuery({ queryKey: key, queryFn: () => listSalesStages(pipeline?.id), enabled: canManage && Boolean(pipeline) });
  const [editing, setEditing] = useState<SalesStage | "new" | null>(null);
  const [pipelineDialog, setPipelineDialog] = useState<Pipeline | "new" | null>(null);
  const [deactivating, setDeactivating] = useState<{ stage: SalesStage; openCount: number } | null>(null);
  const [switchingOff, setSwitchingOff] = useState<{ pipeline: Pipeline; openCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "sales-stage-settings") });
    void queryClient.invalidateQueries({ queryKey: pipelinesKey });
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
  const setPipelineActive = useMutation({
    mutationFn: ({ target, isActive }: { target: Pipeline; isActive: boolean }) => updatePipeline(target.id, { isActive }),
    onSuccess: refresh,
    onError: (failure, { target }) => {
      const openCount = stageInUseCount(failure);
      if (openCount === null) setError(errorMessage(failure));
      else setSwitchingOff({ pipeline: target, openCount });
    },
  });

  if (!canManage) return <PermissionState title="You don't have access to the sales stages" description="Ask an administrator for the Configure pipeline stages permission." />;
  if (pipelines.isLoading || query.isLoading) return <LoadingState label="Loading sales stages" rows={5} />;
  if (pipelines.isError || query.isError) return <ErrorState title="Could not load the sales stages" description="Refresh to try again." action={{ label: "Try again", onPress: () => { void pipelines.refetch(); void query.refetch(); } }} />;

  const all = pipelines.data ?? [];
  const stages = query.data ?? [];
  const active = stages.filter((stage) => stage.isActive);
  const busy = change.isPending || setActive.isPending || setPipelineActive.isPending;
  const move = (index: number, offset: number) => {
    const ids = active.map((stage) => stage.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    change.mutate(() => reorderSalesStages(ids, pipeline?.id));
  };

  const inactive = stages.filter((stage) => !stage.isActive);
  const stageRow = (stage: SalesStage) => {
    const index = active.findIndex((entry) => entry.id === stage.id);
    const required = stage.entryRules.filter((entry) => entry.level === "require").map((entry) => STAGE_RULE_LABELS[entry.rule]);
    const warned = stage.entryRules.filter((entry) => entry.level === "warn").map((entry) => STAGE_RULE_LABELS[entry.rule]);
    const goals = (stage.guidance ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return (
      <li key={stage.id} className={`flex items-start gap-3 px-4 py-4 ${stage.isActive ? "" : "bg-surface-muted"}`}>
        <span aria-hidden="true" className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${stage.isActive ? "border-brand/40 text-brand" : "border-border text-text-muted"}`}>
          {stage.isActive ? index + 1 : "–"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-medium ${stage.isActive ? "text-text" : "text-text-muted"}`}>{stage.name}</span>
            <Badge tone="brand">{stage.probability}%</Badge>
            {stage.isStandard && <Badge tone="neutral">Standard</Badge>}
            {stage.timeLimitDays && <Badge tone="warning">{`Within ${stage.timeLimitDays} ${stage.timeLimitDays === 1 ? "day" : "days"}`}</Badge>}
            {!stage.isActive && <StatusBadge tone="neutral">Inactive</StatusBadge>}
          </div>
          {stage.description && <p className="text-text-secondary">{stage.description}</p>}
          {/* The goals as the deal page shows them under the stage track. */}
          {goals.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-text-secondary">
              {goals.map((line) => <li key={line} className="flex gap-1.5"><span aria-hidden="true" className="text-text-muted">•</span>{line}</li>)}
            </ul>
          )}
          {(required.length > 0 || warned.length > 0) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {required.length > 0 && <span className="text-text"><span className="font-medium">Needs:</span> {required.join(", ")}</span>}
              {warned.length > 0 && <span className="text-text-secondary"><span className="font-medium">Asks to confirm without:</span> {warned.join(", ")}</span>}
            </div>
          )}
          <span className="text-xs text-text-muted">{`${stage.openCount} open ${stage.openCount === 1 ? "deal" : "deals"} in this stage`}</span>
        </div>
        {/* On a phone the actions sit in a menu so each stage stays one compact row. */}
        <div className="shrink-0 sm:hidden">
          <MoreMenu label={`Actions for ${stage.name}`} items={[
            ...(stage.isActive ? [
              { id: "up", label: "Move earlier", isDisabled: index === 0 || busy, onAction: () => move(index, -1) },
              { id: "down", label: "Move later", isDisabled: index === active.length - 1 || busy, onAction: () => move(index, 1) },
            ] : []),
            { id: "edit", label: "Edit", onAction: () => setEditing(stage) },
            { id: "active", label: stage.isActive ? "Deactivate" : "Activate", isDisabled: busy, onAction: () => setActive.mutate({ stage, isActive: !stage.isActive }) },
          ]} />
        </div>
        {/* Tablet and desktop: the same places in every row, so the buttons line up; words on every button. */}
        <div className="hidden shrink-0 items-center gap-1 sm:grid sm:grid-cols-[auto_auto_auto_6.5rem]">
          {stage.isActive ? (
            <>
              <Button variant="ghost" size="compact" aria-label={`Move ${stage.name} earlier`} isDisabled={index === 0 || busy} onPress={() => move(index, -1)}>
                <ArrowUp className="size-4" aria-hidden="true" />Up
              </Button>
              <Button variant="ghost" size="compact" aria-label={`Move ${stage.name} later`} isDisabled={index === active.length - 1 || busy} onPress={() => move(index, 1)}>
                <ArrowDown className="size-4" aria-hidden="true" />Down
              </Button>
            </>
          ) : <><span aria-hidden="true" /><span aria-hidden="true" /></>}
          <Button variant="ghost" size="compact" onPress={() => setEditing(stage)}>Edit</Button>
          <Button variant="ghost" size="compact" isDisabled={busy} onPress={() => setActive.mutate({ stage, isActive: !stage.isActive })}>{stage.isActive ? "Deactivate" : "Activate"}</Button>
        </div>
      </li>
    );
  };

  // Desktop: the pipeline and its stages on the left, how stages work on the right. Tablet and phone: one column, the stages first.
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader
        title="Pipelines and deal stages"
        description="The steps a deal moves through while it is open: the columns of the pipeline, each giving a deal its default probability. Run several pipelines when deals follow different steps."
        primaryAction={<Button variant="primary" className="flex-1 sm:flex-none" onPress={() => setEditing("new")} isDisabled={!pipeline?.isActive}><Plus className="size-4" aria-hidden="true" />New stage</Button>}
        secondaryActions={<LinkButton variant="outline" className="flex-1 sm:flex-none" href={`/crm/pipeline${pipeline && !pipeline.isDefault ? `?pipelineId=${pipeline.id}` : ""}`}>Open pipeline</LinkButton>}
      />
      <ErrorBanner message={error} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="pipeline-choice" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <h2 id="pipeline-choice" className="sr-only">Pipeline</h2>
            <Select label="Pipeline" selectedKey={pipeline?.id ?? null} onSelectionChange={(next) => setChosen(String(next))}
              options={all.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.isDefault ? " (default)" : ""}${entry.isActive ? "" : " (off)"}` }))} />
            {pipeline && (
              <p className="text-sm text-text-secondary">
                {pipeline.isDefault ? "The default pipeline: new deals start here unless their team has its own. " : ""}
                {pipeline.teamName ? `Deals created by ${pipeline.teamName} start here. ` : ""}
                {`${pipeline.openCount} open ${pipeline.openCount === 1 ? "deal" : "deals"}.`}
              </p>
            )}
            {/* Phone: two buttons a row, all the same style. Tablet and desktop: one row, Switch off at the far end. */}
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 sm:flex sm:flex-wrap sm:items-center">
              <Button variant="secondary" size="compact" onPress={() => setPipelineDialog("new")}><Plus className="size-4" aria-hidden="true" />New pipeline</Button>
              {pipeline && <Button variant="secondary" size="compact" isDisabled={!pipeline.isActive} onPress={() => setPipelineDialog(pipeline)}>Edit pipeline</Button>}
              {pipeline && !pipeline.isDefault && pipeline.isActive && (
                <Button variant="secondary" size="compact" isDisabled={busy} onPress={() => change.mutate(() => updatePipeline(pipeline.id, { isDefault: true }))}>Make default</Button>
              )}
              {pipeline && !pipeline.isDefault && (
                <Button variant="secondary" size="compact" className="sm:ml-auto" isDisabled={busy}
                  onPress={() => setPipelineActive.mutate({ target: pipeline, isActive: !pipeline.isActive })}>{pipeline.isActive ? "Switch off" : "Switch on"}</Button>
              )}
            </div>
          </section>

          <section aria-labelledby="pipeline-stages" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
              <h2 id="pipeline-stages" className="text-sm font-semibold text-text">{`${active.length} active stage${active.length === 1 ? "" : "s"}`}</h2>
              <span className="hidden text-xs text-text-muted sm:inline">Up and Down change the order of the columns.</span>
            </div>
            {active.length === 0 ? <p className="px-4 py-6 text-sm text-text-secondary">No active stages. Add one with New stage.</p>
              : <ol className="flex flex-col divide-y divide-border">{active.map(stageRow)}</ol>}
          </section>

          {inactive.length > 0 && (
            <section aria-labelledby="pipeline-inactive" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
              <h2 id="pipeline-inactive" className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{`Inactive stages (${inactive.length})`}</h2>
              <ul className="flex flex-col divide-y divide-border">{inactive.map(stageRow)}</ul>
            </section>
          )}
        </div>

        <section aria-labelledby="stages-how" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 id="stages-how" className="text-sm font-semibold text-text">How stages work</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            <li>The order is only how the pipeline is shown. It never moves a deal or rewrites its stage history.</li>
            <li>Renaming a stage keeps every deal and its history with it.</li>
            <li>A stage is never deleted, only deactivated, so the history of deals that passed through it stays readable. Its open deals are moved to a stage you choose.</li>
            <li>Changing a stage&apos;s probability updates its open deals, except those whose probability was set by hand.</li>
            <li>A stage&apos;s rules decide what a deal needs to enter it: Required refuses the move, Ask to confirm warns first.</li>
            <li>A time limit flags deals that stay longer: their owner is told, and their manager when a deal stays twice as long.</li>
            <li>Won and Lost are outcomes, set with Mark won and Mark lost, not stages.</li>
          </ul>
        </section>
      </div>
      {editing && pipeline && <StageDialog stage={editing === "new" ? null : editing} pipelineId={pipeline.id} onClose={() => setEditing(null)} onSaved={refresh} />}
      {deactivating && (
        <DeactivateDialog stage={deactivating.stage} openCount={deactivating.openCount} targets={active.filter((stage) => stage.id !== deactivating.stage.id)}
          onClose={() => setDeactivating(null)} onDone={refresh} />
      )}
      {pipelineDialog && (
        <PipelineDialog pipeline={pipelineDialog === "new" ? null : pipelineDialog} pipelines={all.filter((entry) => entry.isActive)} onClose={() => setPipelineDialog(null)}
          onSaved={(saved) => { refresh(); setChosen(saved.id); }} />
      )}
      {switchingOff && (
        <SwitchOffDialog pipeline={switchingOff.pipeline} openCount={switchingOff.openCount} targets={all.filter((entry) => entry.isActive && entry.id !== switchingOff.pipeline.id)}
          onClose={() => setSwitchingOff(null)} onDone={refresh} />
      )}
    </div>
  );
}

const RULE_KEYS = Object.keys(STAGE_RULE_LABELS) as StageRuleKey[];
const LEVEL_OPTIONS = [
  { value: "none", label: "Not checked" },
  { value: "warn", label: "Ask to confirm" },
  { value: "require", label: "Required" },
];

function StageDialog({ stage, pipelineId, onClose, onSaved }: { stage: SalesStage | null; pipelineId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(stage?.name ?? "");
  const [probability, setProbability] = useState(stage ? String(stage.probability) : "");
  const [description, setDescription] = useState(stage?.description ?? "");
  const [guidance, setGuidance] = useState(stage?.guidance ?? "");
  const [timeLimit, setTimeLimit] = useState(stage?.timeLimitDays ? String(stage.timeLimitDays) : "");
  const [rules, setRules] = useState<Record<string, string>>(() => Object.fromEntries((stage?.entryRules ?? []).map((entry) => [entry.rule, entry.level])));
  const [rulesTouched, setRulesTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(probability);
  const limit = timeLimit.trim() === "" ? null : Number(timeLimit);
  const limitValid = limit === null || (Number.isInteger(limit) && limit >= 1 && limit <= 365);
  const valid = Boolean(name.trim()) && probability.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100 && limitValid;
  const entryRules: StageRule[] = RULE_KEYS.filter((rule) => rules[rule] === "require" || rules[rule] === "warn").map((rule) => ({ rule, level: rules[rule] as StageRule["level"] }));
  const mutation = useMutation({
    mutationFn: () => {
      const input = { name, probability: value, description, guidance, timeLimitDays: limit, ...(rulesTouched || !stage ? { entryRules } : {}) };
      return stage ? updateSalesStage(stage.id, input) : createSalesStage({ ...input, pipelineId });
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const restoreStandard = useMutation({
    mutationFn: () => updateSalesStage(stage!.id, { entryRules: null }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={stage ? "Edit stage" : "New stage"} size="lg"
      description={stage ? "Deals in this stage and its history show the new name." : "The new stage is added after the last one; move it to where it belongs."}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <TextField label="Stage name" isRequired value={name} onChange={(next) => { setName(next); setError(null); }} />
          <TextField label="Default probability (%)" isRequired inputMode="numeric" value={probability} onChange={(next) => { setProbability(next); setError(null); }} />
        </div>
        <TextArea label="Description" description="One or two lines: when does a deal belong in this stage? Shown to everyone working deals." value={description} onChange={setDescription} />
        <TextArea label="Guidance" description="The goals of the stage, one per line." value={guidance} onChange={setGuidance} />
        <TextField label="Time limit (days)" inputMode="numeric" description="Optional. A deal that stays longer is flagged; its owner is told, and their manager after twice as long."
          value={timeLimit} onChange={setTimeLimit} isInvalid={!limitValid} errorMessage={limitValid ? undefined : "Enter 1 to 365 days, or leave it empty."} />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">To enter this stage, a deal has</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {RULE_KEYS.map((rule) => (
              <Select key={rule} label={STAGE_RULE_LABELS[rule]} options={LEVEL_OPTIONS} selectedKey={rules[rule] ?? "none"}
                onSelectionChange={(next) => { setRules((current) => ({ ...current, [rule]: String(next) })); setRulesTouched(true); }} />
            ))}
          </div>
          <p className="text-xs text-text-muted">Required refuses the move until the deal has it. Ask to confirm lets the mover go ahead after a warning.</p>
          {stage?.isStandard && !stage.rulesAreStandard && (
            <div><Button variant="ghost" size="compact" isLoading={restoreStandard.isPending} onPress={() => restoreStandard.mutate()}>Use the standard rules</Button></div>
          )}
        </fieldset>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" className="w-full sm:w-auto" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!valid}>{stage ? "Save" : "Add stage"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function PipelineDialog({ pipeline, pipelines, onClose, onSaved }: { pipeline: Pipeline | null; pipelines: Pipeline[]; onClose: () => void; onSaved: (pipeline: Pipeline) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const teams = (options.data?.options.salesTeams ?? []).map((team) => ({ value: String(team.id), label: String(team.name ?? "") }));
  const [name, setName] = useState(pipeline?.name ?? "");
  const [description, setDescription] = useState(pipeline?.description ?? "");
  const [teamId, setTeamId] = useState(pipeline?.teamId ?? "");
  const [copyFrom, setCopyFrom] = useState("standard");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => pipeline
      ? updatePipeline(pipeline.id, { name, description, teamId: teamId || null })
      : createPipeline({ name, description, teamId: teamId || null, copyStagesFrom: copyFrom === "standard" ? null : copyFrom }),
    onSuccess: (saved) => { onSaved(saved); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={pipeline ? `Edit ${pipeline.name}` : "New pipeline"}
      description={pipeline ? undefined : "For deals that follow different steps — projects, renewals, a team's own process. It gets its own stages."}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextField label="Name" isRequired value={name} onChange={setName} maxLength={80} />
        <TextArea label="Description" value={description} onChange={setDescription} maxLength={500} />
        <Select label="Sales team (optional)" description="Deals this team's members create start in this pipeline." selectedKey={teamId || "none"}
          onSelectionChange={(next) => setTeamId(String(next) === "none" ? "" : String(next))} options={[{ value: "none", label: "No team" }, ...teams]} />
        {!pipeline && (
          <Select label="Start with" selectedKey={copyFrom} onSelectionChange={(next) => setCopyFrom(String(next))}
            options={[{ value: "standard", label: "The standard stages" }, ...pipelines.map((entry) => ({ value: entry.id, label: `A copy of ${entry.name}'s stages` }))]} />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" className="w-full sm:w-auto" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>{pipeline ? "Save" : "Create pipeline"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function SwitchOffDialog({ pipeline, openCount, targets, onClose, onDone }: { pipeline: Pipeline; openCount: number; targets: Pipeline[]; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => updatePipeline(pipeline.id, { isActive: false, moveOpenTo: target }),
    onSuccess: () => { onDone(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Switch off ${pipeline.name}`}
      description={`${openCount} open ${openCount === 1 ? "deal is" : "deals are"} in this pipeline. Choose the pipeline to move ${openCount === 1 ? "it" : "them"} to; each goes into its first stage, recorded in the deal's history.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Move the open deals to" isRequired selectedKey={target} onSelectionChange={(key) => setTarget(String(key ?? ""))}
          options={targets.map((entry) => ({ value: entry.id, label: entry.name }))} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="danger" className="w-full sm:w-auto" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!target}>Move and switch off</Button>
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
      description={`${openCount} open ${openCount === 1 ? "deal currently uses" : "deals currently use"} this stage. Choose the stage to move ${openCount === 1 ? "it" : "them"} to; each move is recorded in the deal's stage history.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Move the open deals to" isRequired selectedKey={target} onSelectionChange={(key) => setTarget(String(key ?? ""))}
          options={targets.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.probability}%` }))} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="danger" className="w-full sm:w-auto" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!target}>Move and deactivate</Button>
        </div>
      </div>
    </Dialog>
  );
}
