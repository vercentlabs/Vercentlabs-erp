"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  EmptyState,
  ErrorState,
  PageHeader,
  PermissionState,
  StatusBadge,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";
import { useState } from "react";

import { requestJson } from "@/shared/http/request-json";

type Policy = {
  id: string;
  policy_key: string;
  enabled: boolean;
  allow_read: boolean;
  allow_propose: boolean;
  allow_execute: boolean;
  requires_approval: boolean;
  allowed_tools: string[];
  data_classes: string[];
  version: number;
  updated_at: string;
  updated_by_name: string | null;
};
type AiRequest = { id: string; request_type: string; status: string; action_key: string | null; model_identifier: string | null; created_at: string; user_name: string | null; evaluations: number; evaluations_passed: boolean | null };
type Overview = { policy: Policy | null; versions: Policy[]; requests: AiRequest[]; tools: Array<{ key: string; label: string; description: string }>; dataClasses: Array<{ key: string; label: string }> };
type Draft = { enabled: boolean; allowRead: boolean; allowPropose: boolean; allowExecute: boolean; requiresApproval: boolean; allowedTools: string[]; dataClasses: string[] };

const QUERY_KEY = ["settings", "ai-governance"];
const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function toDraft(policy: Policy | null): Draft {
  return {
    enabled: policy?.enabled ?? false,
    allowRead: policy?.allow_read ?? false,
    allowPropose: policy?.allow_propose ?? false,
    allowExecute: policy?.allow_execute ?? false,
    requiresApproval: policy?.requires_approval ?? true,
    allowedTools: policy?.allowed_tools ?? [],
    dataClasses: policy?.data_classes ?? [],
  };
}

// Settings > AI governance. Fail closed: without a saved policy, AI is off.
// Only tools registered in the platform AI registry can be allowed, and a
// change always creates a new policy version.
export function AiGovernanceScreen({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => requestJson<Overview>("/api/settings/ai-governance"), enabled: canManage });
  // Unsaved edits; null means "show the saved policy".
  const [edits, setDraft] = useState<Draft | null>(null);
  const draft = edits ?? toDraft(query.data?.policy ?? null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => requestJson("/api/settings/ai-governance", { method: "PUT", json: draft }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setDraft(null);
      setSaved(true);
      setError(null);
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The policy could not be saved."),
  });

  if (!canManage) return <PermissionState title="You can't manage AI governance" description="Ask an administrator with the AI governance permission." />;

  const set = (patch: Partial<Draft>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };
  const data = query.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="AI governance" description="Decide whether AI features may be used in your organisation, what they may do, and which data they may see." />
      {query.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {query.isError && <ErrorState title="Could not load AI governance" description={(query.error as Error).message} action={{ label: "Retry", onPress: () => query.refetch() }} />}
      {data && (
        <>
          <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label="Policy">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text">Organisation policy</h2>
              <span className="text-xs text-text-muted">{data.policy ? `Version ${data.policy.version} · ${formatter.format(new Date(data.policy.updated_at))}${data.policy.updated_by_name ? ` · ${data.policy.updated_by_name}` : ""}` : "No policy saved: AI is off"}</span>
            </div>
            <Switch isSelected={draft.enabled} onChange={(enabled) => set({ enabled })}>
              Allow AI features
            </Switch>
            <div className="grid gap-2 sm:grid-cols-2">
              <Checkbox isSelected={draft.allowRead} isDisabled={!draft.enabled} onChange={(allowRead) => set({ allowRead })}>
                May read records
              </Checkbox>
              <Checkbox isSelected={draft.allowPropose} isDisabled={!draft.enabled} onChange={(allowPropose) => set({ allowPropose })}>
                May suggest changes
              </Checkbox>
              <Checkbox isSelected={draft.allowExecute} isDisabled={!draft.enabled} onChange={(allowExecute) => set({ allowExecute })}>
                May make changes
              </Checkbox>
              <Checkbox isSelected={draft.requiresApproval} isDisabled={!draft.enabled} onChange={(requiresApproval) => set({ requiresApproval })}>
                A person must approve every change
              </Checkbox>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text">Allowed tools</span>
              {data.tools.length === 0 ? (
                <p className="rounded-[var(--radius-control)] bg-canvas-strong px-3 py-2 text-sm text-text-secondary">No AI tools are currently registered. When a feature adds one, it appears here and stays off until you allow it.</p>
              ) : (
                <CheckboxGroup aria-label="Allowed tools" value={draft.allowedTools} onChange={(allowedTools) => set({ allowedTools })} isDisabled={!draft.enabled}>
                  {data.tools.map((tool) => (
                    <Checkbox key={tool.key} value={tool.key}>
                      {tool.label}
                    </Checkbox>
                  ))}
                </CheckboxGroup>
              )}
            </div>
            <CheckboxGroup label="Data AI may see" value={draft.dataClasses} onChange={(dataClasses) => set({ dataClasses })} isDisabled={!draft.enabled}>
              {data.dataClasses.map((dataClass) => (
                <Checkbox key={dataClass.key} value={dataClass.key}>
                  {dataClass.label}
                </Checkbox>
              ))}
            </CheckboxGroup>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-3">
              {saved && (
                <span role="status" className="text-sm text-success">
                  Saved as a new version.
                </span>
              )}
              <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>
                Save policy
              </Button>
            </div>
          </section>
          <section className="flex flex-col gap-2" aria-label="Recent AI requests">
            <h2 className="text-sm font-semibold text-text">Recent AI requests</h2>
            {data.requests.length === 0 ? (
              <EmptyState title="No AI requests yet" description="Requests made by AI features are listed here with their outcome. Prompts themselves are never stored." />
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
                <Table caption="Recent AI requests">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>When</TableHeaderCell>
                      <TableHeaderCell>Who</TableHeaderCell>
                      <TableHeaderCell>Kind</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.requests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>{formatter.format(new Date(request.created_at))}</TableCell>
                        <TableCell>{request.user_name ?? "—"}</TableCell>
                        <TableCell>{request.action_key ?? request.request_type}</TableCell>
                        <TableCell>
                          <StatusBadge tone={request.status === "denied" || request.status === "failed" ? "danger" : "neutral"}>{request.status}</StatusBadge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
