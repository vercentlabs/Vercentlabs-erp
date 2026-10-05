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
  TextArea,
  TextField,
} from "@vercentlabs/design-system";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request, SalesApiError } from "@/features/sales/shared/http";
import { SalesAlert, SalesPanel } from "@/features/sales/shared/SalesUi";

type Settings = {
  default_quote_validity_days: number;
  quotation_approval_amount: string | number;
  quotation_approval_discount: string | number;
  minimum_margin_percent: string | number;
  allow_direct_orders: boolean;
  reserve_stock_on_confirm: boolean;
  require_customer_po: boolean;
  require_requested_delivery_date: boolean;
  invoice_quantity_basis: "ordered" | "fulfilled";
  default_quotation_terms: string | null;
  allow_line_discounts: boolean;
  allow_document_discounts: boolean;
  allow_percent_discounts: boolean;
  allow_amount_discounts: boolean;
  discount_reason_above_percent: string | number | null;
  discount_limit_percent: string | number | null;
  discount_limit_elevated_percent: string | number | null;
};
// An empty field means "no limit" / "never required".
const optionalPercent = (value: string | number | null) => (value === null || value === undefined ? "" : String(Number(value)));
const percentOrNull = (value: string) => (value.trim() === "" ? null : Number(value));

// F041/F043 -- the thresholds that decide when a quotation or order needs a
// second person, plus document defaults. Zero on an amount means "no amount
// trigger". Changes apply to documents submitted afterwards; documents already
// awaiting approval keep the decision they were routed with.
export function SalesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "settings"),
    queryFn: () =>
      request<{ settings: Settings }>("/settings").then((r) => r.settings),
  });
  if (query.isLoading)
    return (
      <p className="px-4 py-8 text-sm text-text-secondary">Loading settings…</p>
    );
  if (query.isError || !query.data) {
    if (query.error instanceof SalesApiError && query.error.status === 403)
      return (
        <PermissionState
          title="You don't have access to Sales"
          description="Ask an administrator to grant sales.view."
        />
      );
    return (
      <ErrorState
        title="Could not load Sales settings"
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <SettingsForm settings={query.data} />
    </div>
  );
}

function SettingsForm({ settings }: { settings: Settings }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage =
    workspace.roleSlugs.includes("organization_owner") ||
    workspace.permissions.includes(SALES_PERMISSIONS.settingsManage);
  const [validity, setValidity] = useState(
    settings.default_quote_validity_days,
  );
  const [quoteAmount, setQuoteAmount] = useState(
    Number(settings.quotation_approval_amount),
  );
  const [quoteDiscount, setQuoteDiscount] = useState(
    Number(settings.quotation_approval_discount),
  );
  const [margin, setMargin] = useState(Number(settings.minimum_margin_percent));
  const [direct, setDirect] = useState(settings.allow_direct_orders);
  const [reserveOnConfirm, setReserveOnConfirm] = useState(settings.reserve_stock_on_confirm !== false);
  const [requirePo, setRequirePo] = useState(Boolean(settings.require_customer_po));
  const [requireDelivery, setRequireDelivery] = useState(Boolean(settings.require_requested_delivery_date));
  const [basis, setBasis] = useState<string>(settings.invoice_quantity_basis);
  const [quotationTerms, setQuotationTerms] = useState(settings.default_quotation_terms ?? "");
  const canManageDiscounts =
    workspace.roleSlugs.includes("organization_owner") ||
    workspace.permissions.includes(SALES_PERMISSIONS.discountManageSettings);
  const [lineDiscounts, setLineDiscounts] = useState(settings.allow_line_discounts);
  const [documentDiscounts, setDocumentDiscounts] = useState(settings.allow_document_discounts);
  const [percentDiscounts, setPercentDiscounts] = useState(settings.allow_percent_discounts);
  const [amountDiscounts, setAmountDiscounts] = useState(settings.allow_amount_discounts);
  const [reasonAbove, setReasonAbove] = useState(optionalPercent(settings.discount_reason_above_percent));
  const [discountLimit, setDiscountLimit] = useState(optionalPercent(settings.discount_limit_percent));
  const [managerLimit, setManagerLimit] = useState(optionalPercent(settings.discount_limit_elevated_percent));
  const percentInput = (value: string) => value.replace(/[^0-9.]/g, "");
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      request<{ settings: Settings }>("/settings", {
        method: "PUT",
        body: JSON.stringify({
          defaultQuoteValidityDays: validity,
          quotationApprovalAmount: quoteAmount,
          quotationApprovalDiscount: quoteDiscount,
          minimumMarginPercent: margin,
          allowDirectOrders: direct,
          reserveStockOnConfirm: reserveOnConfirm,
          requireCustomerPo: requirePo,
          requireRequestedDeliveryDate: requireDelivery,
          invoiceQuantityBasis: basis,
          defaultQuotationTerms: quotationTerms,
          ...(canManageDiscounts
            ? {
                allowLineDiscounts: lineDiscounts,
                allowDocumentDiscounts: documentDiscounts,
                allowPercentDiscounts: percentDiscounts,
                allowAmountDiscounts: amountDiscounts,
                discountReasonAbovePercent: percentOrNull(reasonAbove),
                discountLimitPercent: percentOrNull(discountLimit),
                discountLimitElevatedPercent: percentOrNull(managerLimit),
              }
            : {}),
        }),
      }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "sales"),
      });
    },
  });
  const error = save.error
    ? save.error instanceof SalesApiError
      ? save.error.message
      : "Settings could not be saved."
    : null;
  const touch =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
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
            <Button
              variant="primary"
              onPress={() => save.mutate()}
              isLoading={save.isPending}
            >
              Save settings
            </Button>
          ) : undefined
        }
      />
      {!canManage && (
        <SalesAlert tone="info">
          You can view these settings. Changing them needs the Sales settings
          permission.
        </SalesAlert>
      )}
      {error && <SalesAlert>{error}</SalesAlert>}
      {saved && (
        <SalesAlert tone="success">
          Settings saved. They apply to documents submitted from now on.
        </SalesAlert>
      )}

      <SalesPanel
        title="Quotation approval"
        description="A quotation needs approval by someone other than its author when any trigger below is met. Set an amount to 0 to switch that trigger off."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField
            label="Approval above amount"
            value={quoteAmount}
            onChange={touch(setQuoteAmount)}
            minValue={0}
            step={0.01}
            isDisabled={!canManage}
          />
          <NumberField
            label="Approval above discount (%)"
            value={quoteDiscount}
            onChange={touch(setQuoteDiscount)}
            minValue={0}
            maxValue={100}
            step={1}
            isDisabled={!canManage}
          />
          <NumberField
            label="Approval below margin (%)"
            value={margin}
            onChange={touch(setMargin)}
            minValue={-100}
            maxValue={100}
            step={1}
            isDisabled={!canManage}
          />
        </div>
      </SalesPanel>

      <SalesPanel
        title="Sales orders"
        description="Orders are confirmed by someone with the Confirm sales orders permission; there is no order approval."
      >
        <Switch
          isSelected={direct}
          onChange={touch(setDirect)}
          isDisabled={!canManage}
        >
          Allow orders without a quotation
        </Switch>
        <Switch
          isSelected={reserveOnConfirm}
          onChange={touch(setReserveOnConfirm)}
          isDisabled={!canManage}
        >
          Reserve available stock when an order is confirmed
        </Switch>
        <Switch isSelected={requirePo} onChange={touch(setRequirePo)} isDisabled={!canManage}>
          Require the customer&apos;s PO number before an order is confirmed
        </Switch>
        <Switch isSelected={requireDelivery} onChange={touch(setRequireDelivery)} isDisabled={!canManage}>
          Require a requested delivery date before an order is confirmed
        </Switch>
      </SalesPanel>

      <SalesPanel
        title="Pricing & Discounts"
        description="A discount is given on a line or on the whole document, as a percentage or a fixed amount. Standard customer prices belong in price lists, not here."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Switch isSelected={lineDiscounts} onChange={touch(setLineDiscounts)} isDisabled={!canManageDiscounts}>Allow line discounts</Switch>
          <Switch isSelected={documentDiscounts} onChange={touch(setDocumentDiscounts)} isDisabled={!canManageDiscounts}>Allow document discounts</Switch>
          <Switch isSelected={percentDiscounts} onChange={touch(setPercentDiscounts)} isDisabled={!canManageDiscounts}>Percentage discounts</Switch>
          <Switch isSelected={amountDiscounts} onChange={touch(setAmountDiscounts)} isDisabled={!canManageDiscounts}>Fixed amount discounts</Switch>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField
            label="Require a reason above (%)"
            description="Leave empty to never require a reason."
            inputMode="decimal"
            value={reasonAbove}
            onChange={(value) => touch(setReasonAbove)(percentInput(value))}
            isDisabled={!canManageDiscounts}
          />
          <TextField
            label="Salesperson maximum discount (%)"
            description="Leave empty for no limit."
            inputMode="decimal"
            value={discountLimit}
            onChange={(value) => touch(setDiscountLimit)(percentInput(value))}
            isDisabled={!canManageDiscounts}
          />
          <TextField
            label="Manager maximum discount (%)"
            description="For users who may discount up to the higher limit. Leave empty for no limit."
            inputMode="decimal"
            value={managerLimit}
            onChange={(value) => touch(setManagerLimit)(percentInput(value))}
            isDisabled={!canManageDiscounts}
          />
        </div>
        <p className="text-xs text-text-muted">
          The limit applies to each line&apos;s total discount: its own discount plus its share of the document discount. Users who may override the limit are not restricted.
        </p>
      </SalesPanel>

      <SalesPanel title="Document defaults">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField
            label="Quotation validity (days)"
            value={validity}
            onChange={touch(setValidity)}
            minValue={1}
            maxValue={365}
            step={1}
            isDisabled={!canManage}
          />
          <Select
            label="Invoice quantities when not chosen"
            options={[
              { value: "ordered", label: "Ordered quantities" },
              { value: "fulfilled", label: "Fulfilled quantities" },
            ]}
            selectedKey={basis}
            onSelectionChange={(key) =>
              touch(setBasis)(String(key ?? "ordered"))
            }
            isDisabled={!canManage}
          />
        </div>
        <TextArea
          label="Standard terms and conditions for quotations"
          description="Copied onto each new quotation, where it can be changed. Printed on the quotation."
          value={quotationTerms}
          onChange={touch(setQuotationTerms)}
          isDisabled={!canManage}
        />
      </SalesPanel>
    </div>
  );
}
