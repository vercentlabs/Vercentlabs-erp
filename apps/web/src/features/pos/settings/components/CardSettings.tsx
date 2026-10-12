"use client";

// Card set-up per outlet (administrators): the provider and merchant account, whether cards are taken on an integrated terminal or recorded
// from a standalone bank machine (and whether those are accepted before settlement confirms them), refunds, readiness and limits — and the
// outlet's card terminals. Provider credentials are never typed here: only the name of the secret that holds them.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, Switch, TextField } from "@vercentlabs/design-system";
import type { PosCardConfig } from "@vercentlabs/api";

import { PosApiError, request } from "@/features/pos/shared/http";
import { PosPanel } from "@/features/pos/shared/PosUi";

const save = (input: Record<string, unknown>) => request<{ config: PosCardConfig }>("/card-config", { method: "PUT", body: JSON.stringify(input) });
const addTerminal = (input: Record<string, unknown>) => request<{ terminal: unknown }>("/payment-terminals", { method: "POST", body: JSON.stringify(input) });

function OutletCard({ config, onSaved }: { config: PosCardConfig; onSaved: () => void }) {
  const [draft, setDraft] = useState({
    merchantAccountReference: config.merchantAccountReference ?? "", integrationMode: config.integrationMode, standaloneEnabled: config.standaloneEnabled,
    provisionalAcceptance: config.provisionalAcceptance, standaloneApprovalAbove: config.standaloneApprovalAbove ?? "", refundEnabled: config.refundEnabled,
    configurationStatus: config.configurationStatus, maxAmount: config.maxAmount ?? "", credentialReference: config.credentialReference ?? "",
  });
  const [terminal, setTerminal] = useState({ name: "", providerTerminalReference: "", integrationMode: "integrated" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof draft>(key: K) => (value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await work(); onSaved(); } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not save."); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{config.storeName}</p>
        <StatusBadge tone={config.configurationStatus === "ready" ? "success" : config.configurationStatus === "disabled" ? "neutral" : "warning"}>{config.configurationStatus}</StatusBadge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Merchant account" value={draft.merchantAccountReference} onChange={set("merchantAccountReference")} />
        <Select label="How cards are taken" selectedKey={draft.integrationMode} onSelectionChange={(key) => set("integrationMode")(String(key) as typeof draft.integrationMode)}
          options={[{ value: "integrated", label: "Integrated terminal" }, { value: "standalone", label: "Standalone bank machine" }, { value: "both", label: "Both" }]} />
        <Select label="Status" selectedKey={draft.configurationStatus} onSelectionChange={(key) => set("configurationStatus")(String(key) as typeof draft.configurationStatus)}
          options={[{ value: "ready", label: "Ready" }, { value: "incomplete", label: "Incomplete" }, { value: "disabled", label: "Disabled" }]} />
        <TextField label="Credential secret name" description="The name of the secret holding the provider keys, never the keys." value={draft.credentialReference}
          onChange={(value) => set("credentialReference")(value.toUpperCase())} />
        <TextField label="Largest card payment" inputMode="decimal" value={draft.maxAmount} onChange={set("maxAmount")} />
        <TextField label="Approval above (standalone)" inputMode="decimal" value={draft.standaloneApprovalAbove} onChange={set("standaloneApprovalAbove")} />
      </div>
      <Switch isSelected={draft.standaloneEnabled} onChange={set("standaloneEnabled")}>Allow recording payments from a standalone card machine</Switch>
      <Switch isSelected={draft.provisionalAcceptance} onChange={set("provisionalAcceptance")} isDisabled={!draft.standaloneEnabled}>
        Complete the sale before settlement confirms a standalone payment (provisional acceptance — your risk)
      </Switch>
      <Switch isSelected={draft.refundEnabled} onChange={set("refundEnabled")}>Card refunds through the provider</Switch>
      {error && <p className="text-sm text-danger-emphasis">{error}</p>}
      <div><Button variant="primary" size="compact" isLoading={busy} onPress={() => run(() => save({ storeId: config.storeId, ...draft,
        merchantAccountReference: draft.merchantAccountReference || null, credentialReference: draft.credentialReference || null,
        maxAmount: draft.maxAmount || null, standaloneApprovalAbove: draft.standaloneApprovalAbove || null }))}>Save card set-up</Button></div>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-sm font-medium">Card terminals</p>
        {config.terminals.length === 0 && <p className="text-xs text-text-muted">No terminals yet.</p>}
        {config.terminals.map((entry) => (
          <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{entry.name} <span className="text-text-muted">· {entry.providerTerminalReference} · {entry.integrationMode}</span></span>
            <div className="flex items-center gap-2">
              {entry.busy && <StatusBadge tone="warning">In use</StatusBadge>}
              <Button variant="ghost" size="compact" isDisabled={busy}
                onPress={() => run(() => addTerminal({ id: entry.id, name: entry.name, providerTerminalReference: entry.providerTerminalReference, integrationMode: entry.integrationMode,
                  merchantAccountReference: entry.merchantAccountReference, status: entry.status === "active" ? "disabled" : "active", expectedVersion: entry.version }))}>
                {entry.status === "active" ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>
        ))}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <TextField label="Terminal name" value={terminal.name} onChange={(name) => setTerminal((value) => ({ ...value, name }))} />
          <TextField label="Provider device reference" value={terminal.providerTerminalReference} onChange={(providerTerminalReference) => setTerminal((value) => ({ ...value, providerTerminalReference }))} />
          <Select label="Type" selectedKey={terminal.integrationMode} onSelectionChange={(key) => setTerminal((value) => ({ ...value, integrationMode: String(key) }))}
            options={[{ value: "integrated", label: "Integrated" }, { value: "standalone", label: "Standalone" }]} />
          <Button variant="secondary" isDisabled={busy || !terminal.name.trim() || !terminal.providerTerminalReference.trim()}
            onPress={() => run(async () => { await addTerminal({ storeId: config.storeId, providerKey: config.providerKey ?? "sandbox", merchantAccountReference: draft.merchantAccountReference || null, ...terminal });
              setTerminal({ name: "", providerTerminalReference: "", integrationMode: "integrated" }); })}>
            Add terminal
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CardSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pos-card-configs"], queryFn: () => request<{ configs: PosCardConfig[] }>("/card-config").then((response) => response.configs) });
  if (!query.data) return null;
  return (
    <PosPanel title="Card payments" description="Card numbers, CVV and PIN never enter the system: customers pay on the certified terminal. Only provider references and masked card details are kept.">
      {query.data.map((config) => (
        <OutletCard key={`${config.storeId}:${config.terminals.map((entry) => `${entry.id}:${entry.version}`).join(",")}:${config.configurationStatus}`} config={config}
          onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["pos-card-configs"] }); }} />
      ))}
    </PosPanel>
  );
}
