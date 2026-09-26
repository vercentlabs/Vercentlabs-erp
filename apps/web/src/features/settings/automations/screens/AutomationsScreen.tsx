"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  PermissionState,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextArea,
  TextField,
} from "@vercentlabs/design-system";
import { useState } from "react";

import { requestJson } from "@/shared/http/request-json";

type Field = { key: string; label: string; type?: "user" | "list" };
type Trigger = { key: string; label: string; moduleKey: string; conditionFields: Field[] };
type Operator = { key: "equals" | "not_equals" | "in" | "changed_includes"; label: string };
type Condition = { field: string; operator: Operator["key"]; value: string | string[] };
type Recipient = { type: "event_field"; field: string } | { type: "user"; userId: string };
type Action = { type: "notify"; recipient: Recipient; title: string; message: string };
type Workflow = { id: string; name: string; status: "active" | "inactive"; trigger: string; triggerLabel: string; definition: { conditions: Condition[]; actions: Action[] }; version: number; updatedAt: string; lastRunAt: string | null; failedRuns: number };
type Run = { id: string; workflowId: string; version: number; triggerLabel: string; status: string; matched: boolean | null; actionsRun: number; error: string | null; createdAt: string };
type Payload = { workflows: Workflow[]; triggers: Trigger[]; operators: Operator[]; limits: { maxConditions: number; maxActions: number }; members: Array<{ id: string; name: string }> };

const QUERY_KEY = ["settings", "automations"];
const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const RUN_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  pending: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  succeeded: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export function AutomationsScreen({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => requestJson<Payload>("/api/settings/automations"), enabled: canManage });
  const [editing, setEditing] = useState<Workflow | "new" | null>(null);
  const [runsFor, setRunsFor] = useState<Workflow | null>(null);
  const toggle = useMutation({
    mutationFn: (workflow: Workflow) => requestJson(`/api/settings/automations/${workflow.id}/status`, { method: "POST", json: { status: workflow.status === "active" ? "inactive" : "active" } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  if (!canManage) return <PermissionState title="You can't manage automations" description="Ask an administrator with the automations permission." />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Automations"
        description="When something happens, notify the right people. Automations only send in-app notifications and never act with an administrator's permissions."
        primaryAction={
          <Button variant="primary" onPress={() => setEditing("new")} isDisabled={!query.data}>
            New automation
          </Button>
        }
      />
      {query.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {query.isError && <ErrorState title="Could not load automations" description={(query.error as Error).message} action={{ label: "Retry", onPress: () => query.refetch() }} />}
      {query.data &&
        (query.data.workflows.length === 0 ? (
          <EmptyState title="No automations yet" description="For example: when a lead is assigned, notify the new owner." />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <Table caption="Automations">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Automation</TableHeaderCell>
                  <TableHeaderCell>When</TableHeaderCell>
                  <TableHeaderCell>Last run</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {query.data.workflows.map((workflow) => (
                  <TableRow key={workflow.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-text">{workflow.name}</span>
                        <span className="text-xs text-text-muted">{`Version ${workflow.version}`}</span>
                      </div>
                    </TableCell>
                    <TableCell>{workflow.triggerLabel}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{workflow.lastRunAt ? formatter.format(new Date(workflow.lastRunAt)) : "Never"}</span>
                        {workflow.failedRuns > 0 && <span className="text-xs text-danger">{`${workflow.failedRuns} failed`}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={workflow.status === "active" ? "success" : "neutral"}>{workflow.status === "active" ? "On" : "Off"}</StatusBadge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="compact" onPress={() => setRunsFor(workflow)}>
                          Runs
                        </Button>
                        <Button variant="ghost" size="compact" onPress={() => setEditing(workflow)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="compact" isLoading={toggle.isPending && toggle.variables?.id === workflow.id} onPress={() => toggle.mutate(workflow)}>
                          {workflow.status === "active" ? "Turn off" : "Turn on"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      {editing && query.data && (
        <WorkflowBuilder
          payload={query.data}
          workflow={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
          }}
        />
      )}
      {runsFor && <RunsDialog workflow={runsFor} onClose={() => setRunsFor(null)} />}
    </div>
  );
}

function WorkflowBuilder({ payload, workflow, onClose, onSaved }: { payload: Payload; workflow: Workflow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(workflow?.name ?? "");
  const [trigger, setTrigger] = useState(workflow?.trigger ?? payload.triggers[0]?.key ?? "");
  const [conditions, setConditions] = useState<Condition[]>(workflow?.definition.conditions ?? []);
  const [actions, setActions] = useState<Action[]>(workflow?.definition.actions ?? [{ type: "notify", recipient: { type: "user", userId: "" }, title: "", message: "" }]);
  const [error, setError] = useState<string | null>(null);
  const event = payload.triggers.find((entry) => entry.key === trigger);
  const fields = event?.conditionFields ?? [];
  const userFields = fields.filter((field) => field.type === "user");
  const memberOptions = payload.members.map((member) => ({ value: member.id, label: member.name }));

  const save = useMutation({
    mutationFn: () =>
      requestJson(workflow ? `/api/settings/automations/${workflow.id}` : "/api/settings/automations", {
        method: workflow ? "PATCH" : "POST",
        json: { name, trigger, conditions, actions, ...(workflow ? { expectedVersion: workflow.version } : { status: "active" }) },
      }),
    onSuccess: onSaved,
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The automation could not be saved."),
  });

  const changeTrigger = (key: string) => {
    setTrigger(key);
    setConditions([]);
    setActions((current) => current.map((action) => (action.recipient.type === "event_field" ? { ...action, recipient: { type: "user", userId: "" } } : action)));
  };
  const updateCondition = (index: number, patch: Partial<Condition>) => setConditions((current) => current.map((condition, position) => (position === index ? { ...condition, ...patch } : condition)));
  const updateAction = (index: number, patch: Partial<Action>) => setActions((current) => current.map((action, position) => (position === index ? { ...action, ...patch } : action)));

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={workflow ? `Edit "${workflow.name}"` : "New automation"} size="xl">
      <div className="flex flex-col gap-5">
        <TextField label="Name" value={name} onChange={setName} isRequired />
        <section className="flex flex-col gap-2" aria-label="When">
          <h3 className="text-sm font-semibold text-text">When</h3>
          <Select label="This happens" options={payload.triggers.map((entry) => ({ value: entry.key, label: entry.label }))} selectedKey={trigger} onSelectionChange={(key) => changeTrigger(String(key))} />
        </section>
        <section className="flex flex-col gap-2" aria-label="If">
          <h3 className="text-sm font-semibold text-text">If (optional)</h3>
          {conditions.length === 0 && <p className="text-sm text-text-secondary">Runs every time the event happens.</p>}
          {conditions.map((condition, index) => {
            const field = fields.find((entry) => entry.key === condition.field);
            const operators = payload.operators.filter((operator) => (operator.key === "changed_includes" ? field?.type === "list" : field?.type !== "list"));
            return (
              <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
                <Select label="Field" options={fields.map((entry) => ({ value: entry.key, label: entry.label }))} selectedKey={condition.field} onSelectionChange={(key) => { const next = fields.find((entry) => entry.key === String(key)); updateCondition(index, { field: String(key), operator: next?.type === "list" ? "changed_includes" : "equals", value: "" }); }} />
                <Select label="Comparison" options={operators.map((operator) => ({ value: operator.key, label: operator.label }))} selectedKey={condition.operator} onSelectionChange={(key) => updateCondition(index, { operator: key as Operator["key"], value: key === "in" ? [] : "" })} />
                {field?.type === "user" && condition.operator !== "in" ? (
                  <Select label="Member" options={memberOptions} selectedKey={typeof condition.value === "string" && condition.value ? condition.value : null} onSelectionChange={(key) => updateCondition(index, { value: String(key) })} />
                ) : (
                  <TextField
                    label={condition.operator === "in" ? "Values (comma separated)" : "Value"}
                    value={Array.isArray(condition.value) ? condition.value.join(", ") : condition.value}
                    onChange={(value) => updateCondition(index, { value: condition.operator === "in" ? value.split(",").map((part) => part.trim()).filter(Boolean) : value })}
                  />
                )}
                <Button variant="ghost" size="compact" aria-label="Remove condition" onPress={() => setConditions((current) => current.filter((_, position) => position !== index))}>
                  Remove
                </Button>
              </div>
            );
          })}
          {fields.length > 0 && conditions.length < payload.limits.maxConditions && (
            <div>
              <Button variant="secondary" size="compact" onPress={() => setConditions((current) => [...current, { field: fields[0].key, operator: fields[0].type === "list" ? "changed_includes" : "equals", value: "" }])}>
                Add condition
              </Button>
            </div>
          )}
        </section>
        <section className="flex flex-col gap-3" aria-label="Then">
          <h3 className="text-sm font-semibold text-text">Then send a notification</h3>
          {actions.map((action, index) => {
            const recipientKey = action.recipient.type === "event_field" ? `field:${action.recipient.field}` : "member";
            return (
              <div key={index} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select
                    label="To"
                    options={[...userFields.map((field) => ({ value: `field:${field.key}`, label: field.label })), { value: "member", label: "A specific member" }]}
                    selectedKey={recipientKey}
                    onSelectionChange={(key) => updateAction(index, { recipient: String(key).startsWith("field:") ? { type: "event_field", field: String(key).slice(6) } : { type: "user", userId: "" } })}
                  />
                  {action.recipient.type === "user" && (
                    <Select label="Member" options={memberOptions} selectedKey={action.recipient.userId || null} onSelectionChange={(key) => updateAction(index, { recipient: { type: "user", userId: String(key) } })} />
                  )}
                </div>
                <TextField label="Title" value={action.title} onChange={(title) => updateAction(index, { title })} isRequired maxLength={120} />
                <TextArea label="Message" value={action.message} onChange={(message) => updateAction(index, { message })} maxLength={500} />
                {actions.length > 1 && (
                  <div>
                    <Button variant="ghost" size="compact" onPress={() => setActions((current) => current.filter((_, position) => position !== index))}>
                      Remove notification
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {actions.length < payload.limits.maxActions && (
            <div>
              <Button variant="secondary" size="compact" onPress={() => setActions((current) => [...current, { type: "notify", recipient: { type: "user", userId: "" }, title: "", message: "" }])}>
                Add another notification
              </Button>
            </div>
          )}
        </section>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!name.trim() || !trigger || actions.some((action) => !action.title.trim())} isLoading={save.isPending} onPress={() => save.mutate()}>
            {workflow ? "Save new version" : "Create automation"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RunsDialog({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const query = useQuery({ queryKey: [...QUERY_KEY, "runs", workflow.id], queryFn: () => requestJson<{ runs: Run[] }>(`/api/settings/automations/runs?workflowId=${workflow.id}`) });
  const runs = query.data?.runs ?? [];
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Runs: ${workflow.name}`} size="xl">
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : runs.length === 0 ? (
        <EmptyState title="No runs yet" description="A run is recorded each time the trigger event happens while the automation is on." />
      ) : (
        <div className="overflow-x-auto">
          <Table caption="Automation runs">
            <TableHead>
              <TableRow>
                <TableHeaderCell>When</TableHeaderCell>
                <TableHeaderCell>Version</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>{formatter.format(new Date(run.createdAt))}</TableCell>
                  <TableCell>{run.version}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {run.status === "succeeded" && run.matched === false ? (
                        <StatusBadge tone="neutral">Conditions not met</StatusBadge>
                      ) : (
                        <StatusBadge tone={RUN_STATUS[run.status]?.tone ?? "neutral"}>{RUN_STATUS[run.status]?.label ?? run.status}</StatusBadge>
                      )}
                      {run.status === "succeeded" && run.matched !== false && <span className="text-xs text-text-muted">{`${run.actionsRun} notification${run.actionsRun === 1 ? "" : "s"} sent`}</span>}
                      {run.error && <span className="text-xs text-danger">{run.error}</span>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}
