"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState, PageHeader, Switch } from "@vercentlabs/design-system";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";
import { useState } from "react";

// In-app notifications only: that is the one channel the platform delivers
// for every category. Security email (sign-in, password reset, two-step
// verification) is always sent and is not configured here.
type Preference = { category: string; displayName: string; description: string; moduleKey: string; enabled: boolean };

const MODULE_NAME = new Map(ERP_MODULE_CATALOG.map((module) => [module.key as string, module.name]));
const QUERY_KEY = ["settings", "notification-preferences"];

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "Your preference could not be saved.");
  return payload as T;
}

export function NotificationPreferencesScreen() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => request<{ preferences: Preference[] }>("/api/settings/notification-preferences").then((r) => r.preferences) });
  const save = useMutation({
    mutationFn: (input: { category: string; enabled: boolean }) =>
      request("/api/settings/notification-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "Your preference could not be saved."),
  });

  const preferences = query.data ?? [];
  const groups = new Map<string, Preference[]>();
  for (const preference of preferences) groups.set(preference.moduleKey, [...(groups.get(preference.moduleKey) ?? []), preference]);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Notification preferences" description="Choose which in-app notifications you receive. Security emails are always sent." />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load your preferences" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : preferences.length === 0 ? (
        <EmptyState title="Nothing to configure" description="There are no notifications you can turn off yet." />
      ) : (
        [...groups.entries()].map(([moduleKey, items]) => (
          <section key={moduleKey} aria-label={MODULE_NAME.get(moduleKey) ?? moduleKey} className="flex max-w-2xl flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-text">{MODULE_NAME.get(moduleKey) ?? moduleKey}</h2>
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li key={item.category} className="flex flex-col gap-0.5">
                  <Switch isSelected={item.enabled} isDisabled={save.isPending} onChange={(enabled) => save.mutate({ category: item.category, enabled })}>
                    {item.displayName}
                  </Switch>
                  <span className="pl-11 text-xs text-text-muted">{item.description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
