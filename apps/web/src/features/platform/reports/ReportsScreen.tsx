"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextField,
} from "@vercentlabs/design-system";
import { useMemo, useState } from "react";

import { requestJson } from "@/shared/http/request-json";

type Dataset = { key: string; moduleKey: string; label: string; description: string; columns: Array<{ key: string; label: string }>; filters: Array<{ key: string; label: string }>; maxRows: number };
type Definition = { id: string; name: string; datasetKey: string; datasetLabel: string; columns: string[]; filters: Record<string, string>; status: string; createdByName: string | null; isMine: boolean };
type Run = { id: string; datasetLabel: string; definitionName: string | null; status: "queued" | "running" | "succeeded" | "failed"; rowCount: number | null; error: string | null; requestedByName: string | null; requestedAt: string; downloadable: boolean; outputExpiresAt: string | null };

const KEY = ["reports"];
const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const RUN_STATUS: Record<Run["status"], { label: string; tone: "success" | "info" | "danger" | "neutral" }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  succeeded: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

// Reports: pick a dataset you are allowed to see, choose columns and simple
// filters, and run it in the background. The worker re-checks your access
// when it runs; the CSV is kept for a limited time.
export function ReportsScreen() {
  const queryClient = useQueryClient();
  const datasets = useQuery({ queryKey: [...KEY, "datasets"], queryFn: () => requestJson<{ datasets: Dataset[] }>("/api/reports/datasets") });
  const definitions = useQuery({ queryKey: [...KEY, "definitions"], queryFn: () => requestJson<{ definitions: Definition[] }>("/api/reports/definitions") });
  const runs = useQuery({
    queryKey: [...KEY, "runs"],
    queryFn: () => requestJson<{ runs: Run[] }>("/api/reports/runs"),
    refetchInterval: (query) => (query.state.data?.runs.some((run) => run.status === "queued" || run.status === "running") ? 3000 : false),
  });
  const [datasetKey, setDatasetKey] = useState<string | null>(null);
  const [chosenColumns, setColumns] = useState<string[] | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const available = useMemo(() => datasets.data?.datasets ?? [], [datasets.data]);
  const dataset = available.find((entry) => entry.key === datasetKey) ?? available[0] ?? null;
  // Every column until the user narrows the choice; reset when the dataset changes.
  const columns = chosenColumns ?? dataset?.columns.map((column) => column.key) ?? [];
  const chooseDataset = (key: string) => {
    setDatasetKey(key);
    setColumns(null);
    setFilters({});
  };

  const refreshRuns = () => queryClient.invalidateQueries({ queryKey: [...KEY, "runs"] });
  const fail = (failure: unknown) => setMessage({ tone: "danger", text: failure instanceof Error ? failure.message : "Something went wrong." });
  const run = useMutation({
    mutationFn: (input: { definitionId?: string; datasetKey?: string; columns?: string[]; filters?: Record<string, string> }) => requestJson("/api/reports/runs", { method: "POST", json: input }),
    onSuccess: () => {
      setMessage({ tone: "success", text: "Report queued. It appears below when ready." });
      void refreshRuns();
    },
    onError: fail,
  });
  const saveDefinition = useMutation({
    mutationFn: () => requestJson("/api/reports/definitions", { method: "POST", json: { name, datasetKey: dataset?.key, columns, filters } }),
    onSuccess: () => {
      setName("");
      setMessage({ tone: "success", text: "Report saved." });
      void queryClient.invalidateQueries({ queryKey: [...KEY, "definitions"] });
    },
    onError: fail,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports" description="Build a report from the data you can access and download it as CSV." />
      {message && (
        <p role={message.tone === "danger" ? "alert" : "status"} className={message.tone === "danger" ? "text-sm text-danger" : "text-sm text-success"}>
          {message.text}
        </p>
      )}
      {datasets.isError && <ErrorState title="Could not load reports" description={(datasets.error as Error).message} action={{ label: "Retry", onPress: () => datasets.refetch() }} />}
      {datasets.data && available.length === 0 && <EmptyState title="No reports available" description="Reports appear here for the modules you have access to." />}
      {dataset && (
        <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label="New report">
          <Select label="Data" options={available.map((entry) => ({ value: entry.key, label: entry.label }))} selectedKey={dataset.key} onSelectionChange={(key) => chooseDataset(String(key))} description={dataset.description} />
          <CheckboxGroup label="Columns" value={columns} onChange={setColumns} orientation="horizontal">
            {dataset.columns.map((column) => (
              <Checkbox key={column.key} value={column.key}>
                {column.label}
              </Checkbox>
            ))}
          </CheckboxGroup>
          <div className="grid gap-3 sm:grid-cols-2">
            {dataset.filters.map((filter) => (
              <TextField key={filter.key} label={filter.label} value={filters[filter.key] ?? ""} onChange={(value) => setFilters((current) => ({ ...current, [filter.key]: value }))} />
            ))}
          </div>
          <p className="text-xs text-text-muted">{`Up to ${dataset.maxRows.toLocaleString()} rows.`}</p>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <TextField label="Save as" value={name} onChange={setName} placeholder="Report name" />
              <Button variant="secondary" isDisabled={!name.trim() || columns.length === 0} isLoading={saveDefinition.isPending} onPress={() => saveDefinition.mutate()}>
                Save report
              </Button>
            </div>
            <Button variant="primary" isDisabled={columns.length === 0} isLoading={run.isPending} onPress={() => run.mutate({ datasetKey: dataset.key, columns, filters })}>
              Run report
            </Button>
          </div>
        </section>
      )}
      {(definitions.data?.definitions.length ?? 0) > 0 && (
        <section className="flex flex-col gap-2" aria-label="Saved reports">
          <h2 className="text-sm font-semibold text-text">Saved reports</h2>
          <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
            {definitions.data!.definitions.map((definition) => (
              <li key={definition.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-text">{definition.name}</span>
                  <span className="text-xs text-text-muted">{`${definition.datasetLabel}${definition.createdByName ? ` · ${definition.createdByName}` : ""}`}</span>
                </div>
                <Button variant="secondary" size="compact" isLoading={run.isPending && run.variables?.definitionId === definition.id} onPress={() => run.mutate({ definitionId: definition.id })}>
                  Run
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-2" aria-label="Recent runs">
        <h2 className="text-sm font-semibold text-text">Recent runs</h2>
        {(runs.data?.runs.length ?? 0) === 0 ? (
          <p className="text-sm text-text-secondary">No reports have been run yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <Table caption="Recent report runs">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Report</TableHeaderCell>
                  <TableHeaderCell>Requested</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">Download</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.data!.runs.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.definitionName ?? entry.datasetLabel}</TableCell>
                    <TableCell>{`${formatter.format(new Date(entry.requestedAt))}${entry.requestedByName ? ` · ${entry.requestedByName}` : ""}`}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <StatusBadge tone={RUN_STATUS[entry.status]?.tone ?? "neutral"}>{RUN_STATUS[entry.status]?.label ?? entry.status}</StatusBadge>
                        {entry.status === "succeeded" && <span className="text-xs text-text-muted">{`${entry.rowCount ?? 0} rows`}</span>}
                        {entry.error && <span className="text-xs text-danger">{entry.error}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {entry.downloadable ? (
                        <a className="text-sm font-medium text-brand underline-offset-2 hover:underline" href={`/api/reports/runs/${entry.id}/download`} download>
                          Download CSV
                        </a>
                      ) : entry.status === "succeeded" ? (
                        <span className="text-xs text-text-muted">Expired</span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
