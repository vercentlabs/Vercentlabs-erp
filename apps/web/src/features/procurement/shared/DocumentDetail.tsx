"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, ErrorState, MetricStrip, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request, ProcApiError } from "@/features/procurement/shared/http";
import { actOn, getRecord, type ProcRecord } from "@/features/procurement/shared/api";
import { dateTime, statusLabel, statusTone } from "@/features/procurement/shared/format";
import { ProcAlert, ProcFacts, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { useCan } from "@/features/procurement/shared/use-can";
import { useLookup, type Lookup } from "@/features/procurement/shared/use-lookup";

export type ActionDef = {
  action: string;
  label: string;
  // Which statuses offer this action, and the permission that reveals it. The
  // server re-checks both plus the state machine, so this only avoids offering
  // buttons that would be refused.
  from: string[];
  permission: string;
  primary?: boolean;
  // "required": dialog demands a reason; "optional": dialog offers one; undefined: runs immediately.
  reason?: "required" | "optional";
  hint?: string;
  extra?: (record: ProcRecord) => Record<string, unknown>;
};

export type LinkDef = { label: string; href: (record: ProcRecord) => string; from: string[]; permission: string };
export type LineGrid = { title: string; key: string; columns: (lookup: Lookup) => ColumnDef<Record<string, unknown>, unknown>[] };
export type ExtraSection = { id: string; label: string; render: (record: ProcRecord, refresh: () => void, lookup: Lookup) => ReactNode };

export type DetailConfig = {
  resource: string;
  backHref: string;
  backLabel: string;
  noun: string;
  title: (record: ProcRecord) => string;
  fields: (record: ProcRecord, lookup: Lookup) => Array<{ label: string; value: ReactNode }>;
  metrics?: (record: ProcRecord, lookup: Lookup) => Array<{ label: string; value: string }>;
  actions: ActionDef[];
  links?: LinkDef[];
  editHref?: (record: ProcRecord) => string;
  editPermission?: string;
  lineGrids?: LineGrid[];
  sections?: ExtraSection[];
  banner?: (record: ProcRecord, lookup: Lookup) => ReactNode;
};

// One record page for every Procurement document: header with status, the
// lifecycle actions that are valid NOW for this caller, metrics, lines, extra
// sections, and the audit timeline. Lifecycle rules (state machine, per-action
// permission, optimistic concurrency, self-approval blocking) are the server's.
export function DocumentDetail({ config, id }: { config: DetailConfig; id: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = useCan();
  const lookup = useLookup();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<ActionDef | null>(null);
  const [reason, setReason] = useState("");

  const key = scopedQueryKey(workspace, "procurement", config.resource, id);
  const query = useQuery({
    queryKey: key,
    queryFn: () => getRecord(config.resource, id),
    retry: (count, err) => !(err instanceof ProcApiError && [403, 404].includes(err.status)) && count < 2,
  });
  const timeline = useQuery({
    queryKey: [...key, "timeline"],
    queryFn: () => request<{ timeline: Array<{ id: string; label: string; entry_type: string; occurred_at: string; payload?: Record<string, unknown> }> }>(`/${config.resource}/${id}/timeline`).then((r) => r.timeline),
    enabled: query.isSuccess,
    retry: false,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
  }
  const run = useMutation({
    mutationFn: ({ def, why }: { def: ActionDef; why: string }) => actOn(config.resource, id, def.action, { expectedVersion: query.data?.version, ...(why ? { reason: why } : {}), ...(def.extra && query.data ? def.extra(query.data) : {}) }),
    onSuccess: (_record, { def }) => {
      setError(null);
      setNotice(`${def.label} done.`);
      setPending(null);
      setReason("");
      refresh();
    },
    onError: (err) => setError(err instanceof ProcApiError ? err.message : "This action could not be completed."),
  });

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (query.isError || !query.data) {
    if (query.error instanceof ProcApiError && query.error.status === 403) return <PermissionState title={`You don't have access to this ${config.noun}`} />;
    if (query.error instanceof ProcApiError && query.error.status === 404) return <ErrorState title={`${config.noun} not found`} action={{ label: config.backLabel, onPress: () => router.push(config.backHref) }} />;
    return <ErrorState title={`Could not load this ${config.noun}`} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const record = query.data;
  const available = config.actions.filter((def) => def.from.includes(record.status) && can(def.permission));
  const links = (config.links ?? []).filter((link) => link.from.includes(record.status) && can(link.permission));
  const primary = available.find((def) => def.primary);
  const others = available.filter((def) => def !== primary);
  const canEdit = config.editHref && ["draft", "rejected"].includes(record.status) && can(config.editPermission);

  function trigger(def: ActionDef) {
    setError(null);
    setNotice(null);
    if (def.reason) {
      setPending(def);
      setReason("");
    } else run.mutate({ def, why: "" });
  }
  const button = (def: ActionDef, variant: "primary" | "secondary") => (
    <Button key={def.action} variant={variant} onPress={() => trigger(def)} isLoading={run.isPending && run.variables?.def.action === def.action && !pending}>
      {def.label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <Link href={config.backHref} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {config.backLabel}
      </Link>
      <RecordDetailsPage
        header={{
          title: config.title(record),
          status: <StatusBadge tone={statusTone(record.status)}>{statusLabel(record.status)}</StatusBadge>,
          fields: config.fields(record, lookup).slice(0, 4),
          primaryAction: primary ? button(primary, "primary") : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <Button variant="secondary" onPress={() => router.push(config.editHref!(record))}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit
                </Button>
              )}
              {links.map((link) => (
                <Button key={link.label} variant="secondary" onPress={() => router.push(link.href(record))}>
                  {link.label}
                </Button>
              ))}
              {others.map((def) => button(def, "secondary"))}
            </div>
          ),
        }}
      >
        {error && <ProcAlert>{error}</ProcAlert>}
        {notice && !error && <ProcAlert tone="success">{notice}</ProcAlert>}
        {config.banner?.(record, lookup)}
        {config.metrics && <MetricStrip metrics={config.metrics(record, lookup)} />}
        <Tabs>
          <TabList aria-label={`${config.noun} sections`}>
            <Tab id="overview">Overview</Tab>
            {(config.sections ?? []).map((section) => (
              <Tab key={section.id} id={section.id}>
                {section.label}
              </Tab>
            ))}
            <Tab id="activity">Activity</Tab>
          </TabList>
          <TabPanel id="overview" className="flex flex-col gap-4">
            <ProcPanel title="Details">
              <ProcFacts items={config.fields(record, lookup)} />
            </ProcPanel>
            {(config.lineGrids ?? []).map((grid) => {
              const rows = (Array.isArray(record[grid.key]) ? record[grid.key] : []) as Array<Record<string, unknown>>;
              return (
                <ProcPanel key={grid.key} title={grid.title}>
                  <EnterpriseDataGrid<Record<string, unknown>> aria-label={grid.title} columns={grid.columns(lookup)} data={rows.map((row, position) => ({ ...row, _position: position }))} getRowId={(row) => String(row.id ?? row._position)} density="compact" state={rows.length ? "ready" : "empty"} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">Nothing here yet.</p>} />
                </ProcPanel>
              );
            })}
          </TabPanel>
          {(config.sections ?? []).map((section) => (
            <TabPanel key={section.id} id={section.id} className="flex flex-col gap-4">
              {section.render(record, refresh, lookup)}
            </TabPanel>
          ))}
          <TabPanel id="activity">
            <ProcPanel title="Activity">
              {(timeline.data ?? []).length === 0 ? (
                <p className="text-sm text-text-muted">No activity recorded yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {(timeline.data ?? []).map((entry) => (
                    <li key={entry.id} className="flex flex-col gap-0.5 py-2 text-sm">
                      <span className="font-medium text-text">{statusLabel(entry.label)}</span>
                      <span className="text-xs text-text-muted">{dateTime(entry.occurred_at)}</span>
                      {typeof entry.payload?.reason === "string" && <span className="text-xs text-text-secondary">“{entry.payload.reason}”</span>}
                    </li>
                  ))}
                </ul>
              )}
            </ProcPanel>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {pending && (
        <Dialog isOpen onOpenChange={(open) => !open && setPending(null)} title={pending.label}>
          <div className="flex flex-col gap-4">
            {error && <ProcAlert>{error}</ProcAlert>}
            {pending.hint && <p className="text-sm text-text-secondary">{pending.hint}</p>}
            <TextArea label={pending.reason === "required" ? "Reason" : "Note (optional)"} isRequired={pending.reason === "required"} value={reason} onChange={setReason} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setPending(null)}>
                Close
              </Button>
              <Button variant="primary" onPress={() => run.mutate({ def: pending, why: reason.trim() })} isLoading={run.isPending} isDisabled={pending.reason === "required" && !reason.trim()}>
                {pending.label}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
