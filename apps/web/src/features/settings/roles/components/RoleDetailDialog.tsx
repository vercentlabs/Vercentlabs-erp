"use client";

// A role's details: Overview (what it is, its record access and its permissions), People (who holds it) and History (every saved
// version, with the permissions added and removed).
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Pencil } from "lucide-react";
import { Badge, Button, Dialog } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";

import { getRoleDetail, type PermissionCatalogEntry, type RoleRow } from "../api/roles-api";
import { RecordAccessSummary } from "./RecordAccess";

type Tab = "overview" | "people" | "history";
const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Never");

export function RoleDetailDialog({ role, catalog, appLabel, risk, canEdit, onClose, onCopy, onEdit }: {
  role: RoleRow; catalog: Map<string, PermissionCatalogEntry>; appLabel: string; risk: { label: string; tone: "success" | "warning" | "danger"; meaning: string };
  canEdit: boolean; onClose: () => void; onCopy: () => void; onEdit: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const detail = useQuery({ queryKey: ["settings", "roles", "detail", role.id], queryFn: () => getRoleDetail(role.id) });
  const people = detail.data?.people ?? [];
  const history = detail.data?.history ?? [];
  const name = (key: string) => catalog.get(key)?.name ?? key;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={role.name} size="lg" description={role.description || undefined}>
      <div className="flex flex-col gap-4 pr-1">
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          <Badge tone={risk.tone}>{risk.label}</Badge>
          <span>{risk.meaning}</span>
        </div>
        <div role="tablist" aria-label="Role details" className="flex gap-1 border-b border-border">
          {([["overview", "Overview"], ["people", `People (${role.assigned_user_count})`], ["history", "History"]] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand ${tab === key ? "border-brand text-brand" : "border-transparent text-text-secondary hover:text-text"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">{`${appLabel} · ${role.permission_keys.length} permission${role.permission_keys.length === 1 ? "" : "s"} · ${role.is_system ? "Built-in" : "Custom"}`}</p>
            <RecordAccessSummary permissionKeys={role.permission_keys} />
            <PermissionGroups keys={role.permission_keys} catalog={catalog} />
          </div>
        )}

        {tab === "people" && (detail.isLoading ? <LoadingState label="Loading people" rows={3} /> : people.length === 0 ? (
          <p className="text-sm text-text-secondary">Nobody has this role. Give it to people in Users.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border">
            {people.map((person) => (
              <li key={person.userId} className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="flex flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-medium text-text">
                    {person.name}
                    {person.isPrimary && <Badge tone="brand">Main role</Badge>}
                    {person.status !== "active" && <Badge tone="neutral">{person.status === "disabled" ? "Disabled" : person.status}</Badge>}
                  </span>
                  <span className="text-xs text-text-secondary">{person.email}</span>
                </span>
                <span className="text-xs text-text-muted sm:text-right">{`Given ${when(person.assignedAt)}${person.assignedBy ? ` by ${person.assignedBy}` : ""}`}<br className="max-sm:hidden" />{` Last sign-in: ${when(person.lastSignInAt)}`}</span>
              </li>
            ))}
          </ul>
        ))}

        {tab === "history" && (detail.isLoading ? <LoadingState label="Loading history" rows={3} /> : history.length === 0 ? (
          <p className="text-sm text-text-secondary">No changes recorded. Built-in roles change only with Vercentlabs updates.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {history.map((entry) => (
              <li key={`${entry.version}-${entry.at}`} className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text">{`${entry.reason} · version ${entry.version}`}</span>
                  <span className="text-xs text-text-muted">{`${when(entry.at)}${entry.by ? ` · ${entry.by}` : ""}`}</span>
                </span>
                {entry.added.length > 0 && <Change tone="success" label="Added">{entry.added.map(name).join(", ")}</Change>}
                {entry.removed.length > 0 && <Change tone="danger" label="Removed">{entry.removed.map(name).join(", ")}</Change>}
                {!entry.added.length && !entry.removed.length && <span className="text-xs text-text-secondary">{`${entry.permissionCount} permissions`}</span>}
              </li>
            ))}
          </ol>
        ))}

        {canEdit && (
          <div className="sticky bottom-0 z-10 -mx-1 flex justify-end gap-2 border-t border-border bg-surface-raised px-1 pb-0.5 pt-3 shadow-[0_-8px_12px_-12px_rgba(0,0,0,0.25)]">
            {role.is_system
              ? <Button variant="primary" onPress={onCopy}><Copy className="size-4" aria-hidden="true" />Copy to a custom role</Button>
              : (
                <>
                  <Button variant="secondary" onPress={onCopy}><Copy className="size-4" aria-hidden="true" />Duplicate</Button>
                  <Button variant="primary" onPress={onEdit}><Pencil className="size-4" aria-hidden="true" />Edit role</Button>
                </>
              )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Change({ tone, label, children }: { tone: "success" | "danger"; label: string; children: ReactNode }) {
  return <span className="text-xs text-text-secondary"><span className={`font-medium ${tone === "success" ? "text-success" : "text-danger"}`}>{label}: </span>{children}</span>;
}

// Permissions grouped as the catalogue groups them, in plain words.
export function PermissionGroups({ keys, catalog }: { keys: string[]; catalog: Map<string, PermissionCatalogEntry> }) {
  if (!keys.length) return <p className="text-sm text-text-secondary">This role grants no permissions.</p>;
  const groups = new Map<string, PermissionCatalogEntry[]>();
  for (const key of keys) {
    const entry = catalog.get(key) ?? { key, name: key, category: "Other", description: "" };
    groups.set(entry.category, [...(groups.get(entry.category) ?? []), entry]);
  }
  return (
    <div className="flex flex-col gap-2">
      {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([category, entries]) => (
        <details key={category} className="rounded-[var(--radius-control)] border border-border" open={groups.size <= 2}>
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-text">
            <span>{category}</span><span className="text-xs font-normal text-text-muted">{entries.length}</span>
          </summary>
          <ul className="grid gap-x-6 gap-y-1 border-t border-border px-3 py-2 text-sm text-text-secondary sm:grid-cols-2">
            {entries.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => <li key={entry.key} title={entry.description || entry.key}>{entry.name}</li>)}
          </ul>
        </details>
      ))}
    </div>
  );
}
