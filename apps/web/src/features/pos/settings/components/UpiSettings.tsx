"use client";

// UPI & digital set-up per outlet (administrators). The dynamic QR from the acquiring provider is the default; payment links and UPI intent
// only where the provider offers them. The shop's static QR is off until an administrator enters and verifies the merchant's own UPI ID —
// changing it needs verifying again. Customers always see the merchant name. Provider credentials are never typed here: only the name of
// the secret that holds them.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, Switch, TextField } from "@vercentlabs/design-system";
import type { PosUpiConfig } from "@vercentlabs/api";

import { PosApiError, request } from "@/features/pos/shared/http";
import { PosPanel } from "@/features/pos/shared/PosUi";

const save = (input: Record<string, unknown>) => request<{ config: PosUpiConfig }>("/upi-config", { method: "PUT", body: JSON.stringify(input) });

function OutletUpi({ config, onSaved }: { config: PosUpiConfig; onSaved: () => void }) {
  const [draft, setDraft] = useState({
    merchantDisplayName: config.merchantDisplayName ?? "", merchantAccountReference: config.merchantAccountReference ?? "", configurationStatus: config.configurationStatus,
    staticQrVpa: config.staticQrVpa ?? "", staticQrEnabled: config.staticQrEnabled, provisionalAcceptance: config.provisionalAcceptance, approvalAbove: config.approvalAbove ?? "",
    paymentLinksEnabled: config.paymentLinksEnabled, intentEnabled: config.intentEnabled, qrValiditySeconds: String(config.qrValiditySeconds), refundEnabled: config.refundEnabled,
    maxAmount: config.maxAmount ?? "", credentialReference: config.credentialReference ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof draft>(key: K) => (value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function run(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      await save({ storeId: config.storeId, ...draft, merchantDisplayName: draft.merchantDisplayName || null, merchantAccountReference: draft.merchantAccountReference || null,
        staticQrVpa: draft.staticQrVpa || null, approvalAbove: draft.approvalAbove || null, maxAmount: draft.maxAmount || null, credentialReference: draft.credentialReference || null,
        qrValiditySeconds: Number(draft.qrValiditySeconds), ...extra });
      onSaved();
    } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not save."); } finally { setBusy(false); }
  }
  const vpaVerified = Boolean(config.staticQrVerifiedAt) && draft.staticQrVpa === (config.staticQrVpa ?? "");
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{config.storeName}</p>
        <StatusBadge tone={config.configurationStatus === "ready" ? "success" : config.configurationStatus === "disabled" ? "neutral" : "warning"}>{config.configurationStatus}</StatusBadge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Merchant name customers see" value={draft.merchantDisplayName} onChange={set("merchantDisplayName")} />
        <TextField label="Merchant account" value={draft.merchantAccountReference} onChange={set("merchantAccountReference")} />
        <Select label="Status" selectedKey={draft.configurationStatus} onSelectionChange={(key) => set("configurationStatus")(String(key) as typeof draft.configurationStatus)}
          options={[{ value: "ready", label: "Ready" }, { value: "incomplete", label: "Incomplete" }, { value: "disabled", label: "Disabled" }]} />
        <TextField label="QR valid for (seconds)" inputMode="numeric" value={draft.qrValiditySeconds} onChange={set("qrValiditySeconds")} />
        <TextField label="Credential secret name" description="The name of the secret holding the provider keys, never the keys." value={draft.credentialReference}
          onChange={(value) => set("credentialReference")(value.toUpperCase())} />
        <TextField label="Largest UPI payment" inputMode="decimal" value={draft.maxAmount} onChange={set("maxAmount")} />
      </div>
      <Switch isSelected={draft.paymentLinksEnabled} onChange={set("paymentLinksEnabled")}>Payment links (where the provider offers them)</Switch>
      <Switch isSelected={draft.intentEnabled} onChange={set("intentEnabled")}>UPI intent (where the provider offers it)</Switch>
      <Switch isSelected={draft.refundEnabled} onChange={set("refundEnabled")}>Refunds through the provider</Switch>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-sm font-medium">Shop&apos;s static UPI QR (fallback)</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextField label="Merchant UPI ID" description="The shop's own receiving UPI ID — never a personal one." value={draft.staticQrVpa} onChange={(value) => set("staticQrVpa")(value.trim().toLowerCase())} />
          <Button variant="secondary" isDisabled={busy || !draft.staticQrVpa || vpaVerified} onPress={() => run({ verifyStaticQr: true })}>
            {vpaVerified ? "Verified" : "I have verified this UPI ID"}
          </Button>
        </div>
        <Switch isSelected={draft.staticQrEnabled} onChange={set("staticQrEnabled")} isDisabled={!vpaVerified}>Allow recording payments to the shop&apos;s QR (with the UTR)</Switch>
        <Switch isSelected={draft.provisionalAcceptance} onChange={set("provisionalAcceptance")} isDisabled={!draft.staticQrEnabled}>
          Complete the sale before settlement confirms the UTR (provisional acceptance — your risk)
        </Switch>
        <TextField label="Supervisor approval above" inputMode="decimal" value={draft.approvalAbove} onChange={set("approvalAbove")} />
      </div>
      {error && <p className="text-sm text-danger-emphasis">{error}</p>}
      <div><Button variant="primary" size="compact" isLoading={busy} onPress={() => run()}>Save UPI set-up</Button></div>
    </div>
  );
}

export function UpiSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pos-upi-configs"], queryFn: () => request<{ configs: PosUpiConfig[] }>("/upi-config").then((response) => response.configs) });
  if (!query.data) return null;
  return (
    <PosPanel title="UPI & digital payments" description="Each outlet collects into its own merchant account through its acquiring provider. Only the provider's confirmation completes a sale.">
      {query.data.map((config) => (
        <OutletUpi key={`${config.storeId}:${config.staticQrVerifiedAt ?? ""}:${config.configurationStatus}:${config.staticQrEnabled}`} config={config}
          onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["pos-upi-configs"] }); }} />
      ))}
    </PosPanel>
  );
}
