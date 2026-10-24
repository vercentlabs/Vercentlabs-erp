"use client";

// Online payments (Sales report Phase 3): the company's own Razorpay account, so a customer can pay an invoice from its link and the
// payment is recorded against it. The key secret and webhook secret are write-only: leave them empty to keep the saved ones.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, StatusBadge, Switch, TextField } from "@vercentlabs/design-system";

import { request } from "@/features/sales/shared/http";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Gateway = { provider: "razorpay"; keyId: string; mode: "live" | "test"; active: boolean; webhookUrl: string } | null;

export function OnlinePaymentsPanel({ canManage }: { canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const key = scopedQueryKey(workspace, "sales", "payment-gateway");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ gateway: Gateway }>("/payment-gateway").then((result) => result.gateway), enabled: canManage });
  if (!canManage) return null;
  if (query.isLoading) return <Panel title="Online payments"><p className="text-sm text-text-muted">Loading…</p></Panel>;
  return <GatewayForm key={query.data?.keyId ?? "new"} gateway={query.data ?? null} queryKey={key} />;
}

function GatewayForm({ gateway, queryKey }: { gateway: Gateway; queryKey: readonly unknown[] }) {
  const queryClient = useQueryClient();
  const [keyId, setKeyId] = useState(gateway?.keyId ?? "");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [active, setActive] = useState(gateway?.active ?? true);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => request("/payment-gateway", { method: "PUT", body: JSON.stringify({ keyId: keyId.trim(), keySecret: keySecret.trim() || undefined,
      webhookSecret: webhookSecret.trim() || undefined, active }) }),
    onSuccess: () => { setSaved(true); setKeySecret(""); setWebhookSecret(""); void queryClient.invalidateQueries({ queryKey }); },
  });
  const ready = Boolean(keyId.trim()) && (Boolean(gateway) || (Boolean(keySecret.trim()) && Boolean(webhookSecret.trim())));
  const change = <T,>(setter: (value: T) => void) => (value: T) => { setSaved(false); setter(value); };
  return (
    <Panel title="Online payments" description="Customers pay an invoice from its link with your own Razorpay account; the payment is recorded on the invoice."
      actions={gateway ? <StatusBadge tone={gateway.active ? "success" : "neutral"}>{gateway.active ? `On · ${gateway.mode === "live" ? "Live" : "Test"}` : "Off"}</StatusBadge> : undefined}>
      {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      {saved && <Notice tone="success">Saved.</Notice>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <TextField label="Razorpay key id" value={keyId} onChange={change(setKeyId)} placeholder="rzp_live_…" />
        <TextField label="Key secret" type="password" value={keySecret} onChange={change(setKeySecret)} placeholder={gateway ? "Saved; type to replace" : ""} autoComplete="off" />
        <TextField label="Webhook secret" type="password" value={webhookSecret} onChange={change(setWebhookSecret)} placeholder={gateway ? "Saved; type to replace" : ""} autoComplete="off" />
      </div>
      {gateway && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-text-secondary">In Razorpay, add a webhook for payment.captured to this address, with the webhook secret above:</span>
          <code className="break-all rounded-[var(--radius-control)] bg-surface-muted px-2 py-1 text-xs">{gateway.webhookUrl}</code>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Switch isSelected={active} onChange={change(setActive)}>Show Pay now on invoice links</Switch>
        <Button variant="primary" className="w-full sm:w-auto" isDisabled={!ready} isLoading={save.isPending} onPress={() => save.mutate()}>{gateway ? "Save" : "Connect Razorpay"}</Button>
      </div>
    </Panel>
  );
}
