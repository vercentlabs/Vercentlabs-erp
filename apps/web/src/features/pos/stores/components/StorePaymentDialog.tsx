"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, ErrorState, Select, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { statusLabel } from "@/features/pos/shared/format";
import { PosAlert, PosLoading } from "@/features/pos/shared/PosUi";
import { getPosStorePaymentConfig, setPosStorePaymentConfig, type PosPaymentConfigStore, type PosStorePaymentConfig } from "@/features/pos/stores/api/stores-api";

const NON_CASH = ["card", "upi", "wallet", "bank_transfer"] as const;
type Method = (typeof NON_CASH)[number];

type Draft = Record<Method, { enabled: boolean; providerKey: string; credentialEnvVar: string }>;

function draftFrom(config: PosStorePaymentConfig): Draft {
  const draft = {} as Draft;
  for (const method of NON_CASH) {
    const provider = config.providers.find((candidate) => candidate.payment_method === method && candidate.active) ?? config.providers.find((candidate) => candidate.payment_method === method);
    draft[method] = {
      enabled: config.allowedMethods.includes(method),
      providerKey: provider?.provider_key ?? config.availableProviders[0] ?? "sandbox",
      credentialEnvVar: provider?.credential_env_var ?? "",
    };
  }
  return draft;
}

// Per-store payment methods and providers (F282-F286). Cash is always on. A
// provider is chosen only from the adapters this codebase genuinely
// implements, and the optional credential field is the NAME of an environment
// variable -- a credential value is never entered, stored or shown here; the
// server rejects anything that is not shaped like a variable name.
export function StorePaymentDialog({ store, onClose }: { store: PosPaymentConfigStore; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "store-payment-config", store.id), queryFn: () => getPosStorePaymentConfig(store.id) });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Payment methods — ${store.name}`} size="lg">
      {query.isLoading ? (
        <PosLoading />
      ) : query.isError || !query.data ? (
        <ErrorState title="Could not load payment settings" description={query.error instanceof PosApiError ? query.error.message : undefined} action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : (
        <PaymentForm config={query.data.config} storeId={store.id} onClose={onClose} />
      )}
    </Dialog>
  );
}

function PaymentForm({ config, storeId, onClose }: { config: PosStorePaymentConfig; storeId: string; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(config));
  const [error, setError] = useState<string | null>(null);

  function patch(method: Method, change: Partial<Draft[Method]>) {
    setDraft((current) => ({ ...current, [method]: { ...current[method], ...change } }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const enabled = NON_CASH.filter((method) => draft[method].enabled);
      return setPosStorePaymentConfig(storeId, {
        allowedMethods: enabled,
        providers: Object.fromEntries(enabled.map((method) => [method, { providerKey: draft[method].providerKey, credentialEnvVar: draft[method].credentialEnvVar.trim() || null }])),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "store-payment-config", storeId) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "stores") });
      onClose();
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "The payment settings could not be saved."),
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Choose what this store can take at checkout. Cash is always available. A method only works once it has a provider — until a real payment gateway is connected, the sandbox provider processes test payments only.
      </p>
      {error && <PosAlert>{error}</PosAlert>}

      <div className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Checkbox isSelected isDisabled>
            Cash
          </Checkbox>
          <span className="text-xs text-text-muted">Always on</span>
        </div>
        {NON_CASH.map((method) => (
          <div key={method} className="flex flex-col gap-2 px-3 py-2.5">
            <Checkbox isSelected={draft[method].enabled} onChange={(enabled) => patch(method, { enabled })}>
              {statusLabel(method)}
            </Checkbox>
            {draft[method].enabled && (
              <div className="grid grid-cols-1 gap-3 pl-6 sm:grid-cols-2">
                <Select
                  label="Provider"
                  size="compact"
                  options={config.availableProviders.map((provider) => ({ value: provider, label: statusLabel(provider) }))}
                  selectedKey={draft[method].providerKey}
                  onSelectionChange={(key) => patch(method, { providerKey: String(key ?? "sandbox") })}
                />
                <TextField
                  label="Credential variable (optional)"
                  description="The NAME of an environment variable, e.g. PAYMENT_GATEWAY_KEY — never the credential itself."
                  size="compact"
                  value={draft[method].credentialEnvVar}
                  onChange={(value) => patch(method, { credentialEnvVar: value.toUpperCase() })}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>
          Save payment methods
        </Button>
      </div>
    </div>
  );
}
