"use client";

// The customer portal switch (Sales report Phase 3): on or off, its address to share with customers, and a new address when the old one
// should stop working (everyone signed in is signed out).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, StatusBadge, Switch } from "@vercentlabs/design-system";

import { request } from "@/features/sales/shared/http";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Portal = { on: boolean; url: string | null };

export function CustomerPortalPanel({ canManage }: { canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "customer-portal");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ portal: Portal }>("/customer-portal").then((result) => result.portal), enabled: canManage });
  const [copied, setCopied] = useState(false);
  const save = useMutation({ mutationFn: (input: { on: boolean; newAddress?: boolean }) => request("/customer-portal", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) });
  if (!canManage) return null;
  const portal = query.data;
  return (
    <Panel title="Customer portal" description="Customers sign in with a code sent to their email and see their quotations, orders and invoices."
      actions={portal?.url ? <StatusBadge tone={portal.on ? "success" : "neutral"}>{portal.on ? "On" : "Off"}</StatusBadge> : undefined}>
      {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      <Switch isSelected={Boolean(portal?.on)} isDisabled={query.isLoading || save.isPending} onChange={(on) => save.mutate({ on })}>Customers can sign in to the portal</Switch>
      {portal?.url && (
        <div className="flex flex-col gap-2">
          <code className="break-all rounded-[var(--radius-control)] bg-surface-muted px-2 py-1 text-xs">{portal.url}</code>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" size="compact" className="w-full sm:w-auto"
              onPress={() => { void navigator.clipboard.writeText(portal.url ?? "").then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy address"}</Button>
            <Button variant="ghost" size="compact" className="w-full sm:w-auto" isDisabled={save.isPending}
              onPress={() => save.mutate({ on: portal.on, newAddress: true })}>New address (signs everyone out)</Button>
          </div>
          <p className="text-xs text-text-muted">Who can sign in: the email on a customer, or on one of its contacts.</p>
        </div>
      )}
    </Panel>
  );
}
