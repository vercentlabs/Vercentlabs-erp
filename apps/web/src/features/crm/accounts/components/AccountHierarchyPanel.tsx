"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { AccountApiError, getAccountHierarchy, setAccountParent } from "../api/accounts-api";
import { listAccounts } from "../api/accounts-api";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

// F002 Tranche E — getAccountHierarchy/setAccountParent were already a
// real, already-tested, cycle-guarded backend service with zero frontend
// wiring before this pass (confirmed by grep). Ancestors are ordered
// root-first (depth DESC per the query), so the breadcrumb reads top to
// bottom naturally without re-sorting here.
export function AccountHierarchyPanel({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [parentId, setParentId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const hierarchyQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", accountId, "hierarchy"),
    queryFn: () => getAccountHierarchy(accountId),
  });
  // Candidate parents: the full active Account list minus this account and
  // its own descendants (picking a descendant would be caught server-side
  // by the cycle guard anyway, but excluding them here avoids offering a
  // choice the server will just reject).
  const candidatesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", "hierarchy-candidates"),
    queryFn: () => listAccounts({ status: "active", limit: 200 }),
    enabled: pickerOpen,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts", accountId, "hierarchy") });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts", accountId) });
  }

  const setParentMutation = useMutation({
    mutationFn: () => setAccountParent(accountId, parentId || null),
    onSuccess: () => {
      setError(null);
      setPickerOpen(false);
      invalidate();
    },
    onError: (err: unknown) => setError(err instanceof AccountApiError ? err.message : "The parent account could not be updated."),
  });

  if (hierarchyQuery.isLoading) return <p className="text-sm text-text-secondary">Loading hierarchy…</p>;
  const hierarchy = hierarchyQuery.data;
  if (!hierarchy) return null;

  const descendantIds = new Set(hierarchy.descendants.map((node) => node.id));
  const parentOptions: SelectOption[] = [
    { value: "", label: "No parent (top-level account)" },
    ...(candidatesQuery.data?.rows ?? [])
      .filter((row) => row.id !== accountId && !descendantIds.has(row.id))
      .map((row) => ({ value: row.id, label: row.displayName })),
  ];

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {hierarchy.ancestors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-sm text-text-secondary">
          {hierarchy.ancestors.map((node) => (
            <span key={node.id}>{node.display_name} /</span>
          ))}
          <span className="font-medium text-text">{hierarchy.account.display_name}</span>
        </div>
      )}
      {hierarchy.descendants.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-muted">{hierarchy.metrics.descendantCount} child account{hierarchy.metrics.descendantCount === 1 ? "" : "s"}</span>
          <ul className="flex flex-col gap-1">
            {hierarchy.descendants.map((node) => (
              <li key={node.id} className="text-sm text-text" style={{ paddingLeft: `${(node.depth - 1) * 16}px` }}>
                {node.display_name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hierarchy.ancestors.length === 0 && hierarchy.descendants.length === 0 && <p className="text-sm text-text-muted">No parent or child accounts.</p>}

      {canManage &&
        (pickerOpen ? (
          <div className="flex items-end gap-2">
            <Select label="Parent account" options={parentOptions} selectedKey={parentId} onSelectionChange={(key) => setParentId(String(key ?? ""))} />
            <Button variant="secondary" size="compact" onPress={() => setParentMutation.mutate()} isLoading={setParentMutation.isPending}>
              Save
            </Button>
            <Button variant="secondary" size="compact" onPress={() => setPickerOpen(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="compact"
            className="self-start"
            onPress={() => {
              setParentId(hierarchy.account.parent_party_id || "");
              setPickerOpen(true);
            }}
          >
            Change parent account
          </Button>
        ))}

      {hierarchy.history.length > 0 && (
        <details className="text-sm text-text-secondary">
          <summary className="cursor-pointer">Hierarchy history</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {hierarchy.history.map((event) => (
              <li key={event.id}>
                {event.action === "parent_cleared" ? "Cleared parent" : `Set parent to ${event.new_parent_name}`}
                {event.previous_parent_name ? ` (was ${event.previous_parent_name})` : ""} — {event.changed_by_name || "Unknown"}, {dateFormatter.format(new Date(event.changed_at))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
