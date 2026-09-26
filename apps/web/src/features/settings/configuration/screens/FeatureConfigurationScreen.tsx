"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Dialog, ErrorState, NumberField, PageHeader, PermissionState, RadioGroup, Radio, StatusBadge, Switch } from "@vercentlabs/design-system";
import { useState } from "react";

import { requestJson } from "@/shared/http/request-json";

type Value = number | boolean;
type Entry = {
  namespace: string;
  key: string;
  kind: "setting" | "flag";
  label: string;
  description: string;
  unit: string | null;
  input: { type: "integer"; minimum: number; maximum: number } | { type: "boolean" };
  risk: "low" | "medium" | "high";
  defaultValue: Value;
  effectiveValue: Value;
  isDefault: boolean;
  scheduled: Array<{ version: number; value: Value; effectiveFrom: string }>;
  history: Array<{ version: number; value: Value; status: string; effectiveFrom: string; effectiveTo: string | null; createdAt: string; createdByName: string | null }>;
};

const QUERY_KEY = ["settings", "feature-configuration"];
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function display(entry: Pick<Entry, "unit" | "input">, value: Value) {
  if (entry.input.type === "boolean") return value ? "On" : "Off";
  return entry.unit ? `${value} ${entry.unit}` : String(value);
}

export function FeatureConfigurationScreen({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => requestJson<{ entries: Entry[] }>("/api/settings/feature-configuration"), enabled: canManage });
  const [editing, setEditing] = useState<Entry | null>(null);
  const [historyFor, setHistoryFor] = useState<Entry | null>(null);
  const cancel = useMutation({
    mutationFn: ({ entry, version }: { entry: Entry; version: number }) => requestJson("/api/settings/feature-configuration/cancel", { method: "POST", json: { namespace: entry.namespace, key: entry.key, version } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  if (!canManage) return <PermissionState title="You can't manage feature configuration" description="Ask an administrator with the platform configuration permission." />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Feature configuration" description="Organisation-wide settings and switches. Every change is versioned and can be scheduled for a future date." />
      {query.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {query.isError && <ErrorState title="Could not load configuration" description={(query.error as Error).message} action={{ label: "Retry", onPress: () => query.refetch() }} />}
      <div className="flex flex-col gap-3">
        {query.data?.entries.map((entry) => (
          <section key={`${entry.namespace}.${entry.key}`} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label={entry.label}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex max-w-2xl flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-text">{entry.label}</h2>
                  {entry.risk !== "low" && <StatusBadge tone={entry.risk === "high" ? "danger" : "warning"}>{entry.risk === "high" ? "High impact" : "Affects daily work"}</StatusBadge>}
                </div>
                <p className="text-sm text-text-secondary">{entry.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                  <span className="text-sm font-medium text-text" data-testid="configuration-value">
                    {display(entry, entry.effectiveValue)}
                  </span>
                  <span className="text-xs text-text-muted">{entry.isDefault ? "Default" : `Default is ${display(entry, entry.defaultValue)}`}</span>
                </div>
                <Button variant="secondary" size="compact" onPress={() => setEditing(entry)}>
                  Change
                </Button>
              </div>
            </div>
            {entry.scheduled.length > 0 && (
              <ul className="flex flex-col gap-1">
                {entry.scheduled.map((item) => (
                  <li key={item.version} className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                    <StatusBadge tone="info">Scheduled</StatusBadge>
                    <span>{`${display(entry, item.value)} from ${dateTimeFormatter.format(new Date(item.effectiveFrom))}`}</span>
                    <Button variant="ghost" size="compact" isLoading={cancel.isPending && cancel.variables?.version === item.version} onPress={() => cancel.mutate({ entry, version: item.version })}>
                      Cancel
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {entry.history.length > 0 && (
              <div>
                <Button variant="ghost" size="compact" onPress={() => setHistoryFor(entry)}>
                  {`History (${entry.history.length})`}
                </Button>
              </div>
            )}
          </section>
        ))}
      </div>
      {editing && <ChangeDialog entry={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: QUERY_KEY }); }} />}
      {historyFor && (
        <Dialog isOpen onOpenChange={(open) => !open && setHistoryFor(null)} title={`History: ${historyFor.label}`} size="lg">
          <ul className="flex flex-col divide-y divide-border">
            {historyFor.history.map((item) => (
              <li key={item.version} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span className="text-text">{display(historyFor, item.value)}</span>
                <span className="text-text-secondary">{`${item.status} · from ${dateFormatter.format(new Date(item.effectiveFrom))}${item.createdByName ? ` · by ${item.createdByName}` : ""}`}</span>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </div>
  );
}

function ChangeDialog({ entry, onClose, onSaved }: { entry: Entry; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<Value>(entry.effectiveValue);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [effectiveOn, setEffectiveOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      requestJson("/api/settings/feature-configuration", {
        method: "PUT",
        json: { namespace: entry.namespace, key: entry.key, value, effectiveFrom: when === "later" && effectiveOn ? new Date(`${effectiveOn}T00:00:00`).toISOString() : null },
      }),
    onSuccess: onSaved,
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The change could not be saved."),
  });
  const range = entry.input.type === "integer" ? entry.input : null;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={entry.label} description={entry.description}>
      <div className="flex flex-col gap-4">
        {range ? (
          <NumberField label={entry.unit ? `Value (${entry.unit})` : "Value"} value={Number(value)} minValue={range.minimum} maxValue={range.maximum} step={1} onChange={(next) => setValue(next)} description={`From ${range.minimum} to ${range.maximum}.`} />
        ) : (
          <Switch isSelected={Boolean(value)} onChange={setValue}>
            {value ? "On" : "Off"}
          </Switch>
        )}
        <RadioGroup label="When" value={when} onChange={(next) => setWhen(next as "now" | "later")}>
          <Radio value="now">Now</Radio>
          <Radio value="later">From a future date</Radio>
        </RadioGroup>
        {when === "later" && <DatePicker label="Takes effect on" onChange={(next) => setEffectiveOn(next ? next.toString() : null)} isRequired />}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={(when === "later" && !effectiveOn) || (range !== null && !Number.isFinite(Number(value)))} isLoading={save.isPending} onPress={() => save.mutate()}>
            {when === "later" ? "Schedule change" : "Save"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
