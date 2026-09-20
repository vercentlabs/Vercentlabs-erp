"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, NumberField, PageHeader, PermissionState, Select, Switch, TextField } from "@vercentlabs/design-system";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request, SalesApiError } from "@/features/sales/shared/http";
import { SalesAlert, SalesPanel } from "@/features/sales/shared/SalesUi";

type Settings = {
  seller_state_code: string | null;
  default_quote_validity_days: number;
  quotation_approval_amount: string | number;
  quotation_approval_discount: string | number;
  minimum_margin_percent: string | number;
  order_approval_amount: string | number;
  allow_direct_orders: boolean;
  invoice_quantity_basis: "ordered" | "fulfilled";
};

// F041/F043 -- the thresholds that decide when a quotation or order needs a
// second person, plus document defaults. Zero on an amount means "no amount
// trigger". Changes apply to documents submitted afterwards; documents already
// awaiting approval keep the decision they were routed with.
export function SalesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "settings"), queryFn: () => request<{ settings: Settings }>("/settings").then((r) => r.settings) });
  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading settings…</p>;
  if (query.isError || !query.data) {
    if (query.error instanceof SalesApiError && query.error.status === 403) return <PermissionState title="You don't have access to Sales" description="Ask an administrator to grant sales.view." />;
    return <ErrorState title="Could not load Sales settings" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  return <SettingsForm settings={query.data} />;
}

function SettingsForm({ settings }: { settings: Settings }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(SALES_PERMISSIONS.settingsManage);
  const [state, setState] = useState(settings.seller_state_code ?? "");
  const [validity, setValidity] = useState(settings.default_quote_validity_days);
  const [quoteAmount, setQuoteAmount] = useState(Number(settings.quotation_approval_amount));
  const [quoteDiscount, setQuoteDiscount] = useState(Number(settings.quotation_approval_discount));
  const [margin, setMargin] = useState(Number(settings.minimum_margin_percent));
  const [orderAmount, setOrderAmount] = useState(Number(settings.order_approval_amount));
  const [direct, setDirect] = useState(settings.allow_direct_orders);
  const [basis, setBasis] = useState<string>(settings.invoice_quantity_basis);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      request<{ settings: Settings }>("/settings", {
        method: "PUT",
        body: JSON.stringify({ sellerStateCode: state || null, defaultQuoteValidityDays: validity, quotationApprovalAmount: quoteAmount, quotationApprovalDiscount: quoteDiscount, minimumMarginPercent: margin, orderApprovalAmount: orderAmount, allowDirectOrders: direct, invoiceQuantityBasis: basis }),
      }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales") });
    },
  });
  const error = save.error ? (save.error instanceof SalesApiError ? save.error.message : "Settings could not be saved.") : null;
  const touch = <T,>(setter: (value: T) => void) => (value: T) => {
    setSaved(false);
    setter(value);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sales settings"
        description="When a second person must approve, and the defaults documents start from."
        primaryAction={
          canManage ? (
            <Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending}>
              Save settings
            </Button>
          ) : undefined
        }
      />
      {!canManage && <SalesAlert tone="info">You can view these settings. Changing them needs the Sales settings permission.</SalesAlert>}
      {error && <SalesAlert>{error}</SalesAlert>}
      {saved && <SalesAlert tone="success">Settings saved. They apply to documents submitted from now on.</SalesAlert>}

      <SalesPanel title="Quotation approval" description="A quotation needs approval by someone other than its author when any trigger below is met. Set an amount to 0 to switch that trigger off.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField label="Approval above amount" value={quoteAmount} onChange={touch(setQuoteAmount)} minValue={0} step={0.01} isDisabled={!canManage} />
          <NumberField label="Approval above discount (%)" value={quoteDiscount} onChange={touch(setQuoteDiscount)} minValue={0} maxValue={100} step={1} isDisabled={!canManage} />
          <NumberField label="Approval below margin (%)" value={margin} onChange={touch(setMargin)} minValue={-100} maxValue={100} step={1} isDisabled={!canManage} />
        </div>
      </SalesPanel>

      <SalesPanel title="Order approval">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField label="Approval above amount (0 = never)" value={orderAmount} onChange={touch(setOrderAmount)} minValue={0} step={0.01} isDisabled={!canManage} />
        </div>
        <Switch isSelected={direct} onChange={touch(setDirect)} isDisabled={!canManage}>
          Allow orders without a quotation
        </Switch>
      </SalesPanel>

      <SalesPanel title="Document defaults">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField label="Quotation validity (days)" value={validity} onChange={touch(setValidity)} minValue={1} maxValue={365} step={1} isDisabled={!canManage} />
          <TextField label="Seller state code (GST place of supply)" value={state} onChange={touch(setState)} isDisabled={!canManage} />
          <Select
            label="Invoice quantities when not chosen"
            options={[
              { value: "ordered", label: "Ordered quantities" },
              { value: "fulfilled", label: "Fulfilled quantities" },
            ]}
            selectedKey={basis}
            onSelectionChange={(key) => touch(setBasis)(String(key ?? "ordered"))}
            isDisabled={!canManage}
          />
        </div>
      </SalesPanel>
    </div>
  );
}
