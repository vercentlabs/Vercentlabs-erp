"use client";

// Settings → Finance & Commercial → Item Profiles: Finance's named sets of accounts for items. An inventory profile names the inventory
// asset and goods-received clearing accounts; an accounting profile names revenue, expense, cost of goods sold and price variance.
// Categories suggest profiles and items keep the ones they were given; an item-specific account mapping still comes first. Changing a
// profile's accounts affects postings from now on; posted journals are never touched. Profiles are deactivated, not deleted.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, ComboBox, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { SalesApiError } from "@/features/sales/shared/http";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Account = { key: string; field: string; label: string; accountId: string | null; account: string | null };
type Profile = {
  id: string; kind: "inventory" | "accounting"; kindLabel: string; code: string; name: string; description: string | null; status: "active" | "inactive"; isActive: boolean;
  version: number; accounts: Account[]; itemCount: number; categoryCount: number; updatedAt: string;
} & Record<string, unknown>;
type Option = { id: string; code: string; name: string };

const FIELDS = {
  inventory: [["inventoryAccountId", "Inventory asset"], ["clearingAccountId", "Receipt clearing (GRNI)"]],
  accounting: [["revenueAccountId", "Revenue"], ["expenseAccountId", "Expense"], ["cogsAccountId", "Cost of goods sold"], ["varianceAccountId", "Purchase price variance"]],
} as const;

async function call<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const response = await fetch(`/api/accounting${path}`, {
    method: init?.method ?? "GET", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const message = (error: unknown) => (error instanceof Error && error.message ? error.message : "Something went wrong. Try again.");
const issues = (error: unknown): Record<string, string> =>
  Object.fromEntries(((error instanceof SalesApiError ? (error.payload?.details as { issues?: Array<{ field: string; message: string }> } | undefined)?.issues ?? (error.payload?.issues as Array<{ field: string; message: string }> | undefined) : undefined) ?? [])
    .map((issue) => [issue.field, issue.message]));

export function ItemProfilesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"all" | "inventory" | "accounting">("all");
  const [editing, setEditing] = useState<Profile | "inventory" | "accounting" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "item-profiles"), queryFn: () => call<{ profiles: Profile[] }>("/item-profiles").then((response) => response.profiles) });
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.settings.manage");
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting", "item-profiles") }); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") }); };
  const status = useMutation({
    mutationFn: (profile: Profile) => call(`/item-profiles/${profile.id}/status`, { method: "POST", json: { status: profile.isActive ? "inactive" : "active" } }),
    onSuccess: refresh, onError: (failure) => setError(message(failure)),
  });

  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403) return <PermissionState title="You don't have access to item profiles" description="Ask an administrator for Accounting access." />;
  const rows = (query.data ?? []).filter((entry) => kind === "all" || entry.kind === kind);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Item Profiles" description="Named sets of accounts for items. Categories suggest a profile; each item keeps the profile it was given. A change applies to new postings only."
        primaryAction={canManage ? (
          <span className="flex gap-2">
            <Button variant="outline" onPress={() => setEditing("accounting")}><Plus className="size-4" aria-hidden="true" />Accounting profile</Button>
            <Button variant="primary" onPress={() => setEditing("inventory")}><Plus className="size-4" aria-hidden="true" />Inventory profile</Button>
          </span>
        ) : undefined} />
      {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Select aria-label="Kind" className="w-56" size="compact" selectedKey={kind} onSelectionChange={(key) => setKind(String(key) as typeof kind)}
        options={[{ value: "all", label: "All profiles" }, { value: "inventory", label: "Inventory profiles" }, { value: "accounting", label: "Accounting profiles" }]} />
      {query.isLoading ? <LoadingState label="Loading profiles" rows={4} /> : query.isError ? <ErrorState title="Could not load profiles" description={message(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} /> :
        rows.length === 0 ? <EmptyState title="No item profiles yet" description="Without profiles, items post through the account mappings for their category or the company defaults." /> : (
          <ul className="flex flex-col gap-3">
            {rows.map((profile) => (
              <li key={profile.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{profile.name}</span><span className="text-sm text-text-muted tabular-nums">{profile.code}</span>
                    <StatusBadge tone="info">{profile.kindLabel}</StatusBadge>
                    <StatusBadge tone={profile.isActive ? "success" : "neutral"}>{profile.isActive ? "Active" : "Inactive"}</StatusBadge>
                  </span>
                  {canManage && (
                    <span className="flex gap-1">
                      <Button size="compact" variant="ghost" onPress={() => setEditing(profile)}>Edit</Button>
                      <Button size="compact" variant="ghost" isLoading={status.isPending && status.variables?.id === profile.id} onPress={() => status.mutate(profile)}>{profile.isActive ? "Deactivate" : "Activate"}</Button>
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {profile.accounts.map((account) => (
                    <div key={account.key} className="flex justify-between gap-2"><dt className="text-text-secondary">{account.label}</dt><dd>{account.account ?? <span className="text-text-muted">Not set</span>}</dd></div>
                  ))}
                </dl>
                <p className="text-xs text-text-muted">Used by {profile.itemCount} item{profile.itemCount === 1 ? "" : "s"} and suggested by {profile.categoryCount} categor{profile.categoryCount === 1 ? "y" : "ies"}.</p>
              </li>
            ))}
          </ul>
        )}
      <Dialog isOpen={editing !== null} onOpenChange={(open) => !open && setEditing(null)}
        title={typeof editing === "object" && editing ? `Edit ${editing.name}` : editing === "inventory" ? "New inventory profile" : "New accounting profile"}>
        {editing && <ProfileForm key={typeof editing === "object" ? editing.id : editing} target={editing} onDone={() => { setEditing(null); refresh(); }} onCancel={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function ProfileForm({ target, onDone, onCancel }: { target: Profile | "inventory" | "accounting"; onDone: () => void; onCancel: () => void }) {
  const workspace = useWorkspaceContext();
  const profile = typeof target === "object" ? target : null;
  const kind = profile?.kind ?? (target as "inventory" | "accounting");
  const [values, setValues] = useState<Record<string, string>>(() => ({
    code: profile?.code ?? "", name: profile?.name ?? "", description: profile?.description ?? "",
    ...Object.fromEntries(FIELDS[kind].map(([field]) => [field, String(profile?.[field] ?? "")])),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const accounts = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", "options"),
    queryFn: () => call<{ options: { postingAccounts: Option[] } }>("/view/options").then((response) => response.options.postingAccounts),
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: () => {
      const accountsInput = Object.fromEntries(FIELDS[kind].map(([field]) => [field, values[field] || null]));
      const body = { name: values.name.trim(), description: values.description.trim() || null, ...accountsInput };
      return profile ? call(`/item-profiles/${profile.id}`, { method: "PATCH", json: { ...body, expectedVersion: profile.version } })
        : call("/item-profiles", { method: "POST", json: { ...body, kind, code: values.code.trim() } });
    },
    onSuccess: onDone,
    onError: (failure) => { setErrors(issues(failure)); setError(message(failure)); },
  });
  const set = (field: string) => (value: string) => { setValues((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "" })); };
  const choices = (accounts.data ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }));
  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Code" isRequired isDisabled={Boolean(profile)} value={values.code} onChange={(value) => set("code")(value.toUpperCase())} errorMessage={errors.code} description="Such as RAW-MAT. Fixed once created." />
        <TextField label="Name" isRequired value={values.name} onChange={set("name")} errorMessage={errors.name} />
        {FIELDS[kind].map(([field, label]) => (
          <ComboBox key={field} label={label} placeholder="Search accounts" options={choices} isLoading={accounts.isLoading} selectedKey={values[field] || null}
            onSelectionChange={(key) => set(field)(key === null ? "" : String(key))} errorMessage={errors[field]} />
        ))}
        <TextArea className="sm:col-span-2" label="Description" rows={2} value={values.description} onChange={set("description")} />
      </div>
      {profile && profile.itemCount > 0 && <p className="text-xs text-text-muted">{profile.itemCount} item{profile.itemCount === 1 ? "" : "s"} post through this profile. New postings use the new accounts; posted journals are not changed.</p>}
      <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onCancel}>Cancel</Button><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>{profile ? "Save changes" : "Create profile"}</Button></div>
    </div>
  );
}
