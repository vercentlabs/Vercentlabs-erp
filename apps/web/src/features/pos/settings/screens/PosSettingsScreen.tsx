"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, NumberField, PageHeader, PermissionState, Switch, TextField } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { getPosSettings, updatePosSettings, type PosSettings, type PosSettingsValues } from "@/features/pos/settings/api/settings-api";
import { dateTime } from "@/features/pos/shared/format";
import { PosAlert, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";

// Editable form model: numbers as numbers (the API returns numeric columns as
// strings), everything else as stored.
type FormState = {
  max_line_discount_percent: number;
  max_cart_discount_percent: number;
  discount_approval_threshold_percent: number;
  require_return_approval: boolean;
  prohibit_self_return_approval: boolean;
  allow_negative_stock: boolean;
  allow_price_override: boolean;
  cart_expiry_minutes: number;
  require_shift_reconciliation: boolean;
  default_currency_code: string;
};

function toForm(values: PosSettingsValues): FormState {
  return {
    max_line_discount_percent: Number(values.max_line_discount_percent),
    max_cart_discount_percent: Number(values.max_cart_discount_percent),
    discount_approval_threshold_percent: Number(values.discount_approval_threshold_percent),
    require_return_approval: values.require_return_approval,
    prohibit_self_return_approval: values.prohibit_self_return_approval,
    allow_negative_stock: values.allow_negative_stock,
    allow_price_override: values.allow_price_override,
    cart_expiry_minutes: Number(values.cart_expiry_minutes),
    require_shift_reconciliation: values.require_shift_reconciliation,
    default_currency_code: values.default_currency_code,
  };
}

// The company-level policy every checkout, return and offline-sync path
// already consults. Until this screen existed none of it could be changed
// without editing the database, so every tenant ran on the migration defaults.
// Server-side validation is authoritative (including the rule that the
// approval threshold cannot exceed the maximum line discount); this screen
// mirrors the obvious bounds so the common mistakes are caught before a save.
export function PosSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.settingsManage);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "settings"), queryFn: getPosSettings, enabled: canManage });
  // Lives here, not in the form: saving refreshes the data, which remounts the
  // form (it is keyed by the saved timestamp), so a flag held inside it would
  // be wiped the instant the save succeeded.
  const [saved, setSaved] = useState(false);

  if (!canManage) return <PermissionState title="You don't have access to POS settings" description="Ask an administrator to grant pos.settings.manage." />;
  if (query.isLoading) return <PosLoading label="Loading settings…" />;
  if (query.isError || !query.data) {
    return <ErrorState title="Could not load POS settings" description={query.error instanceof PosApiError ? query.error.message : undefined} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  // Keyed by the saved timestamp so the form always re-initialises from what is
  // actually stored after a save, never from stale local edits.
  return <SettingsForm key={String(query.data.updatedAt ?? "defaults")} data={query.data} saved={saved} onSaved={() => setSaved(true)} onEdited={() => setSaved(false)} />;
}

function SettingsForm({ data, saved, onSaved, onEdited }: { data: PosSettings; saved: boolean; onSaved: () => void; onEdited: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const initial = toForm(data.settings);
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);

  const dirty = (Object.keys(initial) as Array<keyof FormState>).some((key) => form[key] !== initial[key]);
  const thresholdTooHigh = form.discount_approval_threshold_percent > form.max_line_discount_percent;
  const currencyInvalid = !/^[A-Za-z]{3}$/.test(form.default_currency_code.trim());

  function set<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) => {
      onEdited();
      setForm((current) => ({ ...current, [key]: value }));
    };
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      // Send only what changed, so an untouched setting is never re-written.
      const changes: Record<string, string | number | boolean> = {};
      for (const key of Object.keys(initial) as Array<keyof FormState>) {
        if (form[key] !== initial[key]) changes[key] = key === "default_currency_code" ? String(form[key]).trim().toUpperCase() : (form[key] as string | number | boolean);
      }
      return updatePosSettings(changes);
    },
    onSuccess: () => {
      setError(null);
      onSaved();
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "settings") });
    },
    onError: (err) => {
      onEdited();
      setError(err instanceof PosApiError ? err.message : "The settings could not be saved.");
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="POS settings"
        description="Company-wide rules for discounts, returns, stock, carts and shifts. Changes apply to the next sale, return or shift — sales already made are never rewritten."
        primaryAction={
          <div className="flex items-center gap-2">
            {dirty && (
              <Button variant="ghost" onPress={() => setForm(initial)}>
                Discard changes
              </Button>
            )}
            <Button variant="primary" onPress={() => saveMutation.mutate()} isLoading={saveMutation.isPending} isDisabled={!dirty || thresholdTooHigh || currencyInvalid}>
              Save settings
            </Button>
          </div>
        }
      />

      {error && <PosAlert>{error}</PosAlert>}
      {saved && !dirty && <PosAlert tone="success">Settings saved.</PosAlert>}
      {!data.configured && (
        <PosAlert tone="info">This company has not saved POS settings yet, so the standard defaults below are in effect. Saving creates its own settings.</PosAlert>
      )}
      {data.updatedAt && <p className="text-xs text-text-muted">Last changed {dateTime(data.updatedAt)}.</p>}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <PosPanel title="Discounts & approvals" description="Hard limits, and the point above which a supervisor must approve before the sale can complete.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField label="Max line discount (%)" value={form.max_line_discount_percent} onChange={set("max_line_discount_percent")} minValue={0} maxValue={100} step={1} />
            <NumberField label="Max cart discount (%)" value={form.max_cart_discount_percent} onChange={set("max_cart_discount_percent")} minValue={0} maxValue={100} step={1} />
          </div>
          <NumberField
            label="Supervisor approval above (%)"
            description="A manual discount larger than this needs a different person's approval."
            value={form.discount_approval_threshold_percent}
            onChange={set("discount_approval_threshold_percent")}
            minValue={0}
            maxValue={100}
            step={1}
            errorMessage={thresholdTooHigh ? "This cannot be higher than the max line discount — no discount could ever reach it." : undefined}
            isInvalid={thresholdTooHigh}
            className="sm:max-w-xs"
          />
        </PosPanel>

        <PosPanel title="Returns" description="How returns and refunds are authorised.">
          <Switch isSelected={form.require_return_approval} onChange={set("require_return_approval")}>
            Returns need approval before they complete
          </Switch>
          <Switch isSelected={form.prohibit_self_return_approval} onChange={set("prohibit_self_return_approval")} isDisabled={!form.require_return_approval}>
            The person who created a return cannot approve it
          </Switch>
        </PosPanel>

        <PosPanel title="Sales & stock" description="Rules applied while ringing up a sale.">
          <Switch isSelected={form.allow_negative_stock} onChange={set("allow_negative_stock")}>
            Allow selling stock that is not on hand
          </Switch>
          <Switch isSelected={form.allow_price_override} onChange={set("allow_price_override")}>
            Allow cashiers to override an item&apos;s price
          </Switch>
          <NumberField label="Open cart expires after (minutes)" description="5 minutes to 1 week (10,080)." value={form.cart_expiry_minutes} onChange={set("cart_expiry_minutes")} minValue={5} maxValue={10080} step={5} className="sm:max-w-xs" />
        </PosPanel>

        <PosPanel title="Shifts & currency" description="Cash control and the default currency for new stores.">
          <Switch isSelected={form.require_shift_reconciliation} onChange={set("require_shift_reconciliation")}>
            Shifts must be reconciled (counted) when closed
          </Switch>
          <TextField
            label="Default currency code"
            value={form.default_currency_code}
            onChange={(value) => set("default_currency_code")(value.toUpperCase())}
            maxLength={3}
            errorMessage={currencyInvalid ? "Use a 3-letter currency code, e.g. INR." : undefined}
            isInvalid={currencyInvalid}
            className="sm:max-w-[10rem]"
          />
        </PosPanel>
      </div>
    </div>
  );
}
