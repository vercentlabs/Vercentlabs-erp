"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  ErrorState,
  NumberField,
  PageHeader,
  PermissionState,
  Select,
  Switch,
  TextField,
} from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import {
  getPosSettings,
  updatePosSettings,
  type PosSettings,
  type PosSettingsValues,
} from "@/features/pos/settings/api/settings-api";
import { dateTime } from "@/features/pos/shared/format";
import { CardSettings } from "@/features/pos/settings/components/CardSettings";
import { UpiSettings } from "@/features/pos/settings/components/UpiSettings";
import { ReceiptSettings } from "@/features/pos/settings/components/ReceiptSettings";
import { InvoiceSettings } from "@/features/pos/settings/components/InvoiceSettings";
import { ReturnRestrictions } from "@/features/pos/settings/components/ReturnRestrictions";
import { PosAlert, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";

// Editable form model: numbers as numbers (the API returns numeric columns as
// strings), everything else as stored.
type FormState = {
  max_line_discount_percent: number;
  max_cart_discount_percent: number;
  discount_approval_threshold_percent: number;
  manual_discount_stacking: "non_stackable" | "stackable" | "manual_replaces_automatic";
  allow_full_line_discount: boolean;
  discount_reason_required: boolean;
  allow_zero_total_sale: boolean;
  cash_payments_enabled: boolean;
  cash_quick_amounts_enabled: boolean;
  // Empty means no ceiling / no warning.
  max_cash_tender_amount: number | null;
  large_cash_warning_amount: number | null;
  split_payments_enabled: boolean;
  refund_allocation_policy: "proportional" | "electronic_first";
  receipt_reprint_reason_required: boolean;
  require_return_approval: boolean;
  prohibit_self_return_approval: boolean;
  returns_enabled: boolean;
  // Empty means no return window.
  return_window_days: number | null;
  allow_no_receipt_returns: boolean;
  require_return_reason: boolean;
  require_return_condition: boolean;
  allow_partial_returns: boolean;
  allow_cross_outlet_returns: boolean;
  require_inspection_before_refund: boolean;
  return_approval_above: number | null;
  allow_negative_stock: boolean;
  allow_price_override: boolean;
  cart_expiry_minutes: number;
  held_cart_retention_hours: number;
  checkout_lock_minutes: number;
  stock_reservation_max_hold_minutes: number;
  // Empty means an opening count that differs from the handover never needs a supervisor.
  opening_variance_approval_above: number | null;
  // Empty means no hard limit: any difference can be approved.
  opening_variance_block_above: number | null;
  long_open_shift_hours: number;
  // Shift Closing (0105): approval and hard limit for a closing cash difference (empty = never / none), the blind count and whether the counter
  // sees the comparison after counting.
  closing_variance_approval_above: number | null;
  closing_variance_block_above: number | null;
  closing_blind_count: boolean;
  closing_reveal_expected_after_count: boolean;
  // Cash Difference (0106): separate tolerances and hard limits for shortages and overages (empty = the general ones), and whether "I am not sure"
  // needs a note.
  closing_shortage_approval_above: number | null;
  closing_overage_approval_above: number | null;
  closing_shortage_block_above: number | null;
  closing_overage_block_above: number | null;
  cash_difference_unknown_note_required: boolean;
  // Payment Reconciliation (0108): when an in-flight payment is unknown, when a provider refund is overdue, and above which amount a manual match or
  // resolution needs a second person.
  reconciliation_unknown_after_minutes: number;
  reconciliation_refund_overdue_days: number;
  reconciliation_manual_approval_above: number | null;
  // Empty means a walk-in sale never needs buyer details, whatever its total.
  walk_in_buyer_details_required_above: number | null;
  require_shift_reconciliation: boolean;
  default_currency_code: string;
};

function toForm(values: PosSettingsValues): FormState {
  return {
    max_line_discount_percent: Number(values.max_line_discount_percent),
    max_cart_discount_percent: Number(values.max_cart_discount_percent),
    discount_approval_threshold_percent: Number(
      values.discount_approval_threshold_percent,
    ),
    manual_discount_stacking: values.manual_discount_stacking ?? "non_stackable",
    allow_full_line_discount: values.allow_full_line_discount ?? false,
    discount_reason_required: values.discount_reason_required ?? true,
    allow_zero_total_sale: values.allow_zero_total_sale ?? false,
    cash_payments_enabled: values.cash_payments_enabled ?? true,
    cash_quick_amounts_enabled: values.cash_quick_amounts_enabled ?? true,
    max_cash_tender_amount: values.max_cash_tender_amount == null ? null : Number(values.max_cash_tender_amount),
    large_cash_warning_amount: values.large_cash_warning_amount == null ? null : Number(values.large_cash_warning_amount),
    split_payments_enabled: values.split_payments_enabled ?? true,
    refund_allocation_policy: values.refund_allocation_policy ?? "proportional",
    receipt_reprint_reason_required: values.receipt_reprint_reason_required ?? false,
    require_return_approval: values.require_return_approval,
    prohibit_self_return_approval: values.prohibit_self_return_approval,
    returns_enabled: values.returns_enabled ?? true,
    return_window_days: values.return_window_days === undefined ? 30 : values.return_window_days,
    allow_no_receipt_returns: values.allow_no_receipt_returns ?? true,
    require_return_reason: values.require_return_reason ?? true,
    require_return_condition: values.require_return_condition ?? true,
    allow_partial_returns: values.allow_partial_returns ?? true,
    allow_cross_outlet_returns: values.allow_cross_outlet_returns ?? false,
    require_inspection_before_refund: values.require_inspection_before_refund ?? false,
    return_approval_above: values.return_approval_above == null ? null : Number(values.return_approval_above),
    allow_negative_stock: values.allow_negative_stock,
    allow_price_override: values.allow_price_override,
    cart_expiry_minutes: Number(values.cart_expiry_minutes),
    held_cart_retention_hours: Number(values.held_cart_retention_hours ?? 24),
    checkout_lock_minutes: Number(values.checkout_lock_minutes ?? 15),
    stock_reservation_max_hold_minutes: Number(values.stock_reservation_max_hold_minutes ?? 30),
    opening_variance_approval_above: values.opening_variance_approval_above === undefined ? 0 : values.opening_variance_approval_above === null ? null : Number(values.opening_variance_approval_above),
    long_open_shift_hours: Number(values.long_open_shift_hours ?? 14),
    closing_variance_approval_above: values.closing_variance_approval_above === undefined ? 0 : values.closing_variance_approval_above === null ? null : Number(values.closing_variance_approval_above),
    closing_variance_block_above: values.closing_variance_block_above === undefined || values.closing_variance_block_above === null ? null : Number(values.closing_variance_block_above),
    closing_blind_count: values.closing_blind_count ?? true,
    closing_reveal_expected_after_count: values.closing_reveal_expected_after_count ?? true,
    closing_shortage_approval_above: values.closing_shortage_approval_above === undefined || values.closing_shortage_approval_above === null ? null : Number(values.closing_shortage_approval_above),
    closing_overage_approval_above: values.closing_overage_approval_above === undefined || values.closing_overage_approval_above === null ? null : Number(values.closing_overage_approval_above),
    closing_shortage_block_above: values.closing_shortage_block_above === undefined || values.closing_shortage_block_above === null ? null : Number(values.closing_shortage_block_above),
    closing_overage_block_above: values.closing_overage_block_above === undefined || values.closing_overage_block_above === null ? null : Number(values.closing_overage_block_above),
    cash_difference_unknown_note_required: values.cash_difference_unknown_note_required ?? true,
    reconciliation_unknown_after_minutes: Number(values.reconciliation_unknown_after_minutes ?? 30),
    reconciliation_refund_overdue_days: Number(values.reconciliation_refund_overdue_days ?? 7),
    reconciliation_manual_approval_above: values.reconciliation_manual_approval_above === undefined ? 10000 : values.reconciliation_manual_approval_above === null ? null : Number(values.reconciliation_manual_approval_above),
    opening_variance_block_above: values.opening_variance_block_above === undefined || values.opening_variance_block_above === null ? null : Number(values.opening_variance_block_above),
    walk_in_buyer_details_required_above:
      values.walk_in_buyer_details_required_above == null
        ? null
        : Number(values.walk_in_buyer_details_required_above),
    require_shift_reconciliation: values.require_shift_reconciliation,
    default_currency_code: values.default_currency_code,
  };
}

// The organization-level policy every checkout, return and offline-sync path
// already consults. Until this screen existed none of it could be changed
// without editing the database, so every tenant ran on the migration defaults.
// Server-side validation is authoritative (including the rule that the
// approval threshold cannot exceed the maximum line discount); this screen
// mirrors the obvious bounds so the common mistakes are caught before a save.
export function PosSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage =
    workspace.roleSlugs.includes("organization_owner") ||
    workspace.permissions.includes(POS_PERMISSIONS.settingsManage);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "settings"),
    queryFn: getPosSettings,
    enabled: canManage,
  });
  // Lives here, not in the form: saving refreshes the data, which remounts the
  // form (it is keyed by the saved timestamp), so a flag held inside it would
  // be wiped the instant the save succeeded.
  const [saved, setSaved] = useState(false);

  if (!canManage)
    return (
      <PermissionState
        title="You don't have access to POS settings"
        description="Ask an administrator to grant pos.settings.manage."
      />
    );
  if (query.isLoading) return <PosLoading label="Loading settings…" />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="Could not load POS settings"
        description={
          query.error instanceof PosApiError ? query.error.message : undefined
        }
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  }
  // Keyed by the saved timestamp so the form always re-initialises from what is
  // actually stored after a save, never from stale local edits.
  return (
    <div className="flex flex-col gap-4">
      <SettingsForm
        key={String(query.data.updatedAt ?? "defaults")}
        data={query.data}
        saved={saved}
        onSaved={() => setSaved(true)}
        onEdited={() => setSaved(false)}
      />
      {/* Card payments are set up per outlet, saved on their own. */}
      <CardSettings />
      <UpiSettings />
      <ReceiptSettings />
      <InvoiceSettings />
      <ReturnRestrictions />
    </div>
  );
}

function SettingsForm({
  data,
  saved,
  onSaved,
  onEdited,
}: {
  data: PosSettings;
  saved: boolean;
  onSaved: () => void;
  onEdited: () => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const initial = toForm(data.settings);
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);

  const dirty = (Object.keys(initial) as Array<keyof FormState>).some(
    (key) => form[key] !== initial[key],
  );
  const thresholdTooHigh =
    form.discount_approval_threshold_percent > form.max_line_discount_percent;
  const currencyInvalid = !/^[A-Za-z]{3}$/.test(
    form.default_currency_code.trim(),
  );

  function set<K extends keyof FormState>(key: K) {
    return (value: FormState[K]) => {
      onEdited();
      setForm((current) => ({ ...current, [key]: value }));
    };
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      // Send only what changed, so an untouched setting is never re-written.
      const changes: Record<string, string | number | boolean | null> = {};
      for (const key of Object.keys(initial) as Array<keyof FormState>) {
        if (form[key] !== initial[key])
          changes[key] =
            key === "default_currency_code"
              ? String(form[key]).trim().toUpperCase()
              : (form[key] as string | number | boolean | null);
      }
      return updatePosSettings(changes);
    },
    onSuccess: () => {
      setError(null);
      onSaved();
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "pos", "settings"),
      });
    },
    onError: (err) => {
      onEdited();
      setError(
        err instanceof PosApiError
          ? err.message
          : "The settings could not be saved.",
      );
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="POS settings"
        description="Organization-wide rules for discounts, returns, stock, carts and shifts. Changes apply to the next sale, return or shift — sales already made are never rewritten."
        primaryAction={
          <div className="flex items-center gap-2">
            {dirty && (
              <Button variant="ghost" onPress={() => setForm(initial)}>
                Discard changes
              </Button>
            )}
            <Button
              variant="primary"
              onPress={() => saveMutation.mutate()}
              isLoading={saveMutation.isPending}
              isDisabled={!dirty || thresholdTooHigh || currencyInvalid}
            >
              Save settings
            </Button>
          </div>
        }
      />

      {error && <PosAlert>{error}</PosAlert>}
      {saved && !dirty && <PosAlert tone="success">Settings saved.</PosAlert>}
      {!data.configured && (
        <PosAlert tone="info">
          Your organization has not saved POS settings yet, so the standard defaults
          below are in effect. Saving creates its own settings.
        </PosAlert>
      )}
      {data.updatedAt && (
        <p className="text-xs text-text-muted">
          Last changed {dateTime(data.updatedAt)}.
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <PosPanel
          title="Discounts & approvals"
          description="Hard limits, and the point above which a supervisor must approve before the sale can complete."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField
              label="Max line discount (%)"
              value={form.max_line_discount_percent}
              onChange={set("max_line_discount_percent")}
              minValue={0}
              maxValue={100}
              step={1}
            />
            <NumberField
              label="Max cart discount (%)"
              value={form.max_cart_discount_percent}
              onChange={set("max_cart_discount_percent")}
              minValue={0}
              maxValue={100}
              step={1}
            />
          </div>
          <NumberField
            label="Supervisor approval above (%)"
            description="A manual discount larger than this needs a different person's approval."
            value={form.discount_approval_threshold_percent}
            onChange={set("discount_approval_threshold_percent")}
            minValue={0}
            maxValue={100}
            step={1}
            errorMessage={
              thresholdTooHigh
                ? "This cannot be higher than the max line discount — no discount could ever reach it."
                : undefined
            }
            isInvalid={thresholdTooHigh}
            className="sm:max-w-xs"
          />
          <Select
            label="Item discount with an offer"
            description="What happens when a cashier discounts a line that already has an automatic promotion."
            className="sm:max-w-md"
            options={[
              { value: "non_stackable", label: "Not combined — keep the offer, refuse the discount" },
              { value: "manual_replaces_automatic", label: "Manual discount replaces the offer" },
              { value: "stackable", label: "Combined — discount what is left after the offer" },
            ]}
            selectedKey={form.manual_discount_stacking}
            onSelectionChange={(key) => set("manual_discount_stacking")(String(key) as FormState["manual_discount_stacking"])}
          />
          <Switch isSelected={form.discount_reason_required} onChange={set("discount_reason_required")}>
            Item discounts need a reason
          </Switch>
          <Switch isSelected={form.allow_full_line_discount} onChange={set("allow_full_line_discount")}>
            Allow a line or a bill to be discounted in full (100%)
          </Switch>
          <Switch isSelected={form.allow_zero_total_sale} onChange={set("allow_zero_total_sale")}>
            Allow a bill to be completed at a zero total after discounts
          </Switch>
        </PosPanel>

        <PosPanel title="Cash payments" description="How the counter takes cash. Change is worked out by the system; amounts are never rounded automatically.">
          <Switch isSelected={form.cash_payments_enabled} onChange={set("cash_payments_enabled")}>
            Accept cash payments
          </Switch>
          <Switch isSelected={form.cash_quick_amounts_enabled} onChange={set("cash_quick_amounts_enabled")} isDisabled={!form.cash_payments_enabled}>
            Show quick cash amounts at checkout
          </Switch>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField
              label="Largest cash tender"
              description="A safety ceiling on one cash amount. Leave empty for none. Statutory cash limits are not checked here."
              value={form.max_cash_tender_amount ?? Number.NaN}
              onChange={(value) => set("max_cash_tender_amount")(Number.isNaN(value) || value <= 0 ? null : value)}
              minValue={0}
            />
            <NumberField
              label="Warn about cash from"
              description="Shows a large-cash warning at checkout. Leave empty for none."
              value={form.large_cash_warning_amount ?? Number.NaN}
              onChange={(value) => set("large_cash_warning_amount")(Number.isNaN(value) || value <= 0 ? null : value)}
              minValue={0}
            />
          </div>
        </PosPanel>

        <PosPanel title="Split payments" description="One bill paid with cash, card and UPI (one of each) — still one sale and one invoice.">
          <Switch isSelected={form.split_payments_enabled} onChange={set("split_payments_enabled")}>Allow paying one bill with several methods</Switch>
          <Select
            label="Refunds of split bills"
            description="How a return's refund is shared across the methods the customer paid with."
            className="sm:max-w-md"
            options={[
              { value: "proportional", label: "In proportion to each method" },
              { value: "electronic_first", label: "Card and UPI first, cash last" },
            ]}
            selectedKey={form.refund_allocation_policy}
            onSelectionChange={(key) => set("refund_allocation_policy")(String(key) as FormState["refund_allocation_policy"])}
          />
        </PosPanel>

        <PosPanel title="Receipt reprints" description="Another copy of an existing receipt, marked COPY — REPRINTED. Never a new sale, payment or invoice number.">
          <Switch isSelected={form.receipt_reprint_reason_required} onChange={set("receipt_reprint_reason_required")}>Ask for a reason on every reprint</Switch>
        </PosPanel>

        <PosPanel
          title="Returns"
          description="How returns and refunds are authorised."
        >
          <Switch isSelected={form.returns_enabled} onChange={set("returns_enabled")}>Take returns at POS</Switch>
          <NumberField
            label="Return window (days)"
            description="Counted from the sale. Empty means no window. A return outside it needs an override or a supervisor — it never overrides the customer's legal rights."
            className="sm:max-w-xs"
            minValue={0}
            maxValue={3650}
            value={form.return_window_days ?? Number.NaN}
            onChange={(value) => set("return_window_days")(Number.isFinite(value) ? value : null)}
          />
          <Switch isSelected={form.require_return_approval} onChange={set("require_return_approval")}>Every return needs a supervisor&apos;s approval</Switch>
          <NumberField
            label="Supervisor approval above"
            description="Returns refunding more than this need approval. Empty means no amount limit."
            className="sm:max-w-xs"
            minValue={0}
            value={form.return_approval_above ?? Number.NaN}
            onChange={(value) => set("return_approval_above")(Number.isFinite(value) && value > 0 ? value : null)}
          />
          <Switch isSelected={form.allow_no_receipt_returns} onChange={set("allow_no_receipt_returns")}>Allow returns without the receipt (sale found another way, with approval)</Switch>
          <Switch isSelected={form.require_return_reason} onChange={set("require_return_reason")}>A reason is required for each returned item</Switch>
          <Switch isSelected={form.require_return_condition} onChange={set("require_return_condition")}>The condition of each returned stock item is required</Switch>
          <Switch isSelected={form.allow_partial_returns} onChange={set("allow_partial_returns")}>Allow returning part of a line</Switch>
          <Switch isSelected={form.allow_cross_outlet_returns} onChange={set("allow_cross_outlet_returns")}>Allow returns of sales made at another outlet (with approval)</Switch>
          <Switch isSelected={form.require_inspection_before_refund} onChange={set("require_inspection_before_refund")}>Inspect goods on hold before refunding</Switch>
          <p className="text-xs text-text-muted">The person who started a return can never approve it.</p>
        </PosPanel>

        <PosPanel
          title="Sales & stock"
          description="Rules applied while ringing up a sale."
        >
          <Switch
            isSelected={form.allow_negative_stock}
            onChange={set("allow_negative_stock")}
          >
            Allow selling stock that is not on hand
          </Switch>
          <Switch
            isSelected={form.allow_price_override}
            onChange={set("allow_price_override")}
          >
            Allow cashiers to override an item&apos;s price
          </Switch>
          <NumberField
            label="Open cart expires after (minutes)"
            description="5 minutes to 1 week (10,080)."
            value={form.cart_expiry_minutes}
            onChange={set("cart_expiry_minutes")}
            minValue={5}
            maxValue={10080}
            step={5}
            className="sm:max-w-xs"
          />
          <NumberField
            label="Held bill kept for (hours)"
            description="A held bill not resumed in this time expires. 1 hour to 90 days (2,160)."
            value={form.held_cart_retention_hours}
            onChange={set("held_cart_retention_hours")}
            minValue={1}
            maxValue={2160}
            className="sm:max-w-xs"
          />
          <NumberField
            label="Checkout lock lasts (minutes)"
            description="How long a bill at checkout stays locked before it returns to editing. 2 to 240."
            value={form.checkout_lock_minutes}
            onChange={set("checkout_lock_minutes")}
            minValue={2}
            maxValue={240}
            className="sm:max-w-xs"
          />
          <NumberField
            label="Stock held for a paying bill at most (minutes)"
            description="A bill at checkout reserves its stock for as long as the checkout lock, renewed while a payment is under way — never longer than this. 5 to 240."
            value={form.stock_reservation_max_hold_minutes}
            onChange={set("stock_reservation_max_hold_minutes")}
            minValue={5}
            maxValue={240}
            className="sm:max-w-xs"
          />
          <NumberField
            label="Opening count difference needing approval (₹)"
            description="When the cash counted at opening differs from the cash handed over by more than this, a supervisor approves it. 0 = any difference; empty = never."
            value={form.opening_variance_approval_above ?? Number.NaN}
            onChange={(value) => set("opening_variance_approval_above")(Number.isNaN(value) ? null : value)}
            minValue={0}
            className="sm:max-w-xs"
          />
          <NumberField
            label="Opening count difference that blocks opening (₹)"
            description="Above this difference from the cash handed over, the drawer cannot open until a manager resolves it. Empty = no hard limit."
            value={form.opening_variance_block_above ?? Number.NaN}
            onChange={(value) => set("opening_variance_block_above")(Number.isNaN(value) ? null : value)}
            minValue={1}
            className="sm:max-w-xs"
          />
          <NumberField
            label="Closing cash difference needing approval (₹)"
            description="When the cash counted at closing differs from the expected cash by more than this, a supervisor approves it. 0 = any difference; empty = never."
            value={form.closing_variance_approval_above ?? Number.NaN}
            onChange={(value) => set("closing_variance_approval_above")(Number.isNaN(value) ? null : value)}
            minValue={0}
            className="sm:max-w-xs"
          />
          <NumberField
            label="Closing cash difference that only a supervisor can close (₹)"
            description="Above this difference the cashier cannot close; a supervisor reconciles and closes the shift. Empty = no hard limit."
            value={form.closing_variance_block_above ?? Number.NaN}
            onChange={(value) => set("closing_variance_block_above")(Number.isNaN(value) ? null : value)}
            minValue={1}
            className="sm:max-w-xs"
          />
          {([["closing_shortage_approval_above", "Shortage needing approval (₹)", 0], ["closing_overage_approval_above", "Overage needing approval (₹)", 0],
            ["closing_shortage_block_above", "Shortage only a supervisor can close (₹)", 1], ["closing_overage_block_above", "Overage only a supervisor can close (₹)", 1]] as const).map(([field, label, min]) => (
            <NumberField key={field} label={label} description="Empty = use the general amount above." value={form[field] ?? Number.NaN}
              onChange={(value) => set(field)(Number.isNaN(value) ? null : value)} minValue={min} className="sm:max-w-xs" />
          ))}
          <NumberField label="Payment outcome counts as unknown after (minutes)" description="A card / UPI payment still in flight this long becomes a reconciliation exception."
            value={form.reconciliation_unknown_after_minutes} onChange={set("reconciliation_unknown_after_minutes")} minValue={1} maxValue={10080} className="sm:max-w-xs" />
          <NumberField label="Provider refund overdue after (days)" value={form.reconciliation_refund_overdue_days} onChange={set("reconciliation_refund_overdue_days")} minValue={1} maxValue={90} className="sm:max-w-xs" />
          <NumberField label="Manual match / resolution needing a second approver above (₹)" description="Empty = only partial matches and accepted differences need approval."
            value={form.reconciliation_manual_approval_above ?? Number.NaN} onChange={(value) => set("reconciliation_manual_approval_above")(Number.isNaN(value) ? null : value)} minValue={0} className="sm:max-w-xs" />
          <Switch isSelected={form.cash_difference_unknown_note_required} onChange={set("cash_difference_unknown_note_required")}>Ask for a note when the reason is &quot;I am not sure&quot;</Switch>
          <Switch isSelected={form.closing_blind_count} onChange={set("closing_blind_count")}>Blind closing count (the expected cash is shown only after counting)</Switch>
          <Switch isSelected={form.closing_reveal_expected_after_count} onChange={set("closing_reveal_expected_after_count")}>Show the cashier the expected cash and difference after their count</Switch>
          <NumberField
            label="Report a shift as open too long after (hours)"
            description="Shifts open longer than this are listed in the shift openings report. 1 to 72."
            value={form.long_open_shift_hours}
            onChange={set("long_open_shift_hours")}
            minValue={1}
            maxValue={72}
            className="sm:max-w-xs"
          />
          <NumberField
            label="Walk-in buyer details required above"
            description="A walk-in bill over this total needs the buyer's name and address. Leave empty to never require them."
            value={form.walk_in_buyer_details_required_above ?? Number.NaN}
            onChange={(value) =>
              set("walk_in_buyer_details_required_above")(
                Number.isNaN(value) ? null : value,
              )
            }
            minValue={0}
            className="sm:max-w-xs"
          />
        </PosPanel>

        <PosPanel
          title="Shifts & currency"
          description="Cash control and the default currency for new stores."
        >
          <Switch
            isSelected={form.require_shift_reconciliation}
            onChange={set("require_shift_reconciliation")}
          >
            Shifts must be reconciled (counted) when closed
          </Switch>
          <TextField
            label="Default currency code"
            value={form.default_currency_code}
            onChange={(value) =>
              set("default_currency_code")(value.toUpperCase())
            }
            maxLength={3}
            errorMessage={
              currencyInvalid
                ? "Use a 3-letter currency code, e.g. INR."
                : undefined
            }
            isInvalid={currencyInvalid}
            className="sm:max-w-[10rem]"
          />
        </PosPanel>
      </div>
    </div>
  );
}
