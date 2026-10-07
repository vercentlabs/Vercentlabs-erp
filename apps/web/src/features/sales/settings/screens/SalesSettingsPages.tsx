"use client";

// The pages inside Sales Settings: Quotation & Order Rules, Fulfillment and
// Discount Controls. Each reads the organization's Sales settings and saves
// only its own fields; Payment Terms are shared settings (Settings → Payment Terms). Viewing needs
// sales.view, changing needs sales.settings.manage (and, for discounts,
// sales.discount.manage_settings). The server checks both again.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, NumberField, PageHeader, PermissionState, Select, Switch, TextArea, TextField } from "@vercentlabs/design-system";
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
  check_availability_on_confirm: boolean;
  show_prices_on_delivery_note: boolean;
  invoice_quantity_basis: "ordered" | "fulfilled";
  default_warehouse_id: string | null;
  default_quotation_terms: string | null;
  allow_line_discounts: boolean;
  allow_document_discounts: boolean;
  allow_percent_discounts: boolean;
  allow_amount_discounts: boolean;
  discount_reason_above_percent: string | number | null;
  discount_limit_percent: string | number | null;
  discount_limit_elevated_percent: string | number | null;
};
type Warehouse = { id: string; code: string; name: string };
type Loaded = { settings: Settings; warehouses: Warehouse[] };

// An empty field means "no limit" / "never required".
const optionalPercent = (value: string | number | null) => (value === null || value === undefined ? "" : String(Number(value)));
const percentOrNull = (value: string) => (value.trim() === "" ? null : Number(value));
const percentInput = (value: string) => value.replace(/[^0-9.]/g, "");

function useHolds(permission: string) {
  const workspace = useWorkspaceContext();
  return workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
}

// Loads the settings once and renders the page's form when they are there.
function SettingsPage({ title, description, children }: { title: string; description: string; children: (loaded: Loaded) => ReactNode }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "settings"), queryFn: () => request<Loaded>("/settings") });
  return (
    <div className="flex flex-col gap-4">
      <Link href="/sales/settings" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Sales Settings
      </Link>
      {query.isLoading ? <p className="px-4 py-8 text-sm text-text-secondary">Loading settings…</p>
        : query.isError || !query.data ? (
          query.error instanceof SalesApiError && query.error.status === 403
            ? <PermissionState title="You don't have access to Sales" description="Ask an administrator to grant sales.view." />
            : <ErrorState title="Could not load Sales settings" action={{ label: "Retry", onPress: () => query.refetch() }} />
        ) : (
          <>
            <PageHeader title={title} description={description} />
            {children(query.data)}
          </>
        )}
    </div>
  );
}

// Saves the page's own fields; the rest of the settings stay as they are.
function useSave(onSaved: () => void) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => request<{ settings: Settings }>("/settings", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => { onSaved(); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales") }); },
  });
}

function SaveBar({ canManage, save, onSave, saved, readOnlyText }: {
  canManage: boolean; save: ReturnType<typeof useSave>; onSave: () => void; saved: boolean; readOnlyText: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {!canManage && <SalesAlert tone="info">{readOnlyText}</SalesAlert>}
      {save.error && <SalesAlert>{save.error instanceof SalesApiError ? save.error.message : "Settings could not be saved."}</SalesAlert>}
      {saved && <SalesAlert tone="success">Saved. The change applies to documents from now on.</SalesAlert>}
      {canManage && <div><Button variant="primary" isLoading={save.isPending} onPress={onSave}>Save</Button></div>}
    </div>
  );
}

// --------------------------------------------------- quotation & order rules
export function QuotationOrderRulesScreen() {
  return (
    <SettingsPage title="Quotation & Order Rules" description="When a quotation needs a second person, how long it stays valid, and what an order needs before it is confirmed.">
      {({ settings }) => <QuotationOrderRulesForm settings={settings} />}
    </SettingsPage>
  );
}

function QuotationOrderRulesForm({ settings }: { settings: Settings }) {
  const canManage = useHolds(SALES_PERMISSIONS.settingsManage);
  const [saved, setSaved] = useState(false);
  const save = useSave(() => setSaved(true));
  const [validity, setValidity] = useState(settings.default_quote_validity_days);
  const [quoteAmount, setQuoteAmount] = useState(Number(settings.quotation_approval_amount));
  const [quoteDiscount, setQuoteDiscount] = useState(Number(settings.quotation_approval_discount));
  const [margin, setMargin] = useState(Number(settings.minimum_margin_percent));
  const [quotationTerms, setQuotationTerms] = useState(settings.default_quotation_terms ?? "");
  const [direct, setDirect] = useState(settings.allow_direct_orders);
  const [requirePo, setRequirePo] = useState(Boolean(settings.require_customer_po));
  const [requireDelivery, setRequireDelivery] = useState(Boolean(settings.require_requested_delivery_date));
  const touch = <T,>(setter: (value: T) => void) => (value: T) => { setSaved(false); setter(value); };
  return (
    <div className="flex flex-col gap-4">
      <SalesPanel title="Quotation approval" description="A quotation needs approval by someone other than its author when any trigger below is met. Set an amount to 0 to switch that trigger off.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField label="Approval above amount" value={quoteAmount} onChange={touch(setQuoteAmount)} minValue={0} step={0.01} isDisabled={!canManage} />
          <NumberField label="Approval above discount (%)" value={quoteDiscount} onChange={touch(setQuoteDiscount)} minValue={0} maxValue={100} step={1} isDisabled={!canManage} />
          <NumberField label="Approval below margin (%)" value={margin} onChange={touch(setMargin)} minValue={-100} maxValue={100} step={1} isDisabled={!canManage} />
        </div>
      </SalesPanel>
      <SalesPanel title="Quotations">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField label="Quotation validity (days)" value={validity} onChange={touch(setValidity)} minValue={1} maxValue={365} step={1} isDisabled={!canManage} />
        </div>
        <TextArea label="Standard terms and conditions for quotations" description="Copied onto each new quotation, where it can be changed. Printed on the quotation."
          value={quotationTerms} onChange={touch(setQuotationTerms)} isDisabled={!canManage} />
      </SalesPanel>
      <SalesPanel title="Sales orders" description="Orders are confirmed by someone with the Confirm sales orders permission; there is no order approval.">
        <Switch isSelected={direct} onChange={touch(setDirect)} isDisabled={!canManage}>Allow orders without a quotation</Switch>
        <Switch isSelected={requirePo} onChange={touch(setRequirePo)} isDisabled={!canManage}>Require the customer&apos;s PO number before an order is confirmed</Switch>
        <Switch isSelected={requireDelivery} onChange={touch(setRequireDelivery)} isDisabled={!canManage}>Require a requested delivery date before an order is confirmed</Switch>
      </SalesPanel>
      <SaveBar canManage={canManage} save={save} saved={saved} readOnlyText="You can view these rules. Changing them needs the Sales settings permission."
        onSave={() => save.mutate({
          defaultQuoteValidityDays: validity, quotationApprovalAmount: quoteAmount, quotationApprovalDiscount: quoteDiscount, minimumMarginPercent: margin,
          defaultQuotationTerms: quotationTerms, allowDirectOrders: direct, requireCustomerPo: requirePo, requireRequestedDeliveryDate: requireDelivery,
        })} />
    </div>
  );
}

// ---------------------------------------------------------------- fulfillment
export function FulfillmentSettingsScreen() {
  return (
    <SettingsPage title="Fulfillment Settings" description="What invoicing is based on, how stock is checked and reserved when an order is confirmed, the warehouse new orders start from, and the delivery note.">
      {(loaded) => <FulfillmentForm {...loaded} />}
    </SettingsPage>
  );
}

function FulfillmentForm({ settings, warehouses }: Loaded) {
  const canManage = useHolds(SALES_PERMISSIONS.settingsManage);
  const [saved, setSaved] = useState(false);
  const save = useSave(() => setSaved(true));
  const [basis, setBasis] = useState<string>(settings.invoice_quantity_basis);
  const [checkOnConfirm, setCheckOnConfirm] = useState(settings.check_availability_on_confirm !== false);
  const [reserveOnConfirm, setReserveOnConfirm] = useState(settings.reserve_stock_on_confirm !== false);
  const [warehouseId, setWarehouseId] = useState(settings.default_warehouse_id ?? "");
  const [notePrices, setNotePrices] = useState(Boolean(settings.show_prices_on_delivery_note));
  const touch = <T,>(setter: (value: T) => void) => (value: T) => { setSaved(false); setter(value); };
  const inactiveDefault = Boolean(settings.default_warehouse_id) && !warehouses.some((warehouse) => warehouse.id === settings.default_warehouse_id);
  return (
    <div className="flex flex-col gap-4">
      <SalesPanel title="Invoicing">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Invoice based on" description="Sales Order: anything ordered can be invoiced. Delivery: goods only once delivered (services as ordered)."
            options={[{ value: "ordered", label: "Sales Order" }, { value: "fulfilled", label: "Delivery" }]}
            selectedKey={basis} onSelectionChange={(key) => touch(setBasis)(String(key ?? "ordered"))} isDisabled={!canManage} />
        </div>
      </SalesPanel>
      <SalesPanel title="Availability and reservation" description="Availability is on hand minus reserved, in each warehouse; stock under quality hold is not available. Checking availability never blocks an order.">
        <Switch isSelected={checkOnConfirm} onChange={touch(setCheckOnConfirm)} isDisabled={!canManage}>Check availability when an order is confirmed</Switch>
        <Switch isSelected={reserveOnConfirm} onChange={touch(setReserveOnConfirm)} isDisabled={!canManage}>Reserve available stock when an order is confirmed</Switch>
      </SalesPanel>
      <SalesPanel title="Default warehouse" description="Where a new sales order's goods come from unless the order or a line says otherwise. Only a starting value: it can be changed on the order.">
        {inactiveDefault && <SalesAlert tone="warning">The warehouse chosen here is no longer active, so new orders start without one.</SalesAlert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Default warehouse" options={[{ value: "", label: "None" }, ...warehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))]}
            selectedKey={inactiveDefault ? "" : warehouseId} onSelectionChange={(key) => touch(setWarehouseId)(String(key ?? ""))} isDisabled={!canManage} />
        </div>
      </SalesPanel>
      <SalesPanel title="Delivery note" description="Deliveries are dispatched by sales managers and the warehouse; stock is issued at dispatch.">
        <Switch isSelected={notePrices} onChange={touch(setNotePrices)} isDisabled={!canManage}>Show prices on the delivery note</Switch>
        <p className="text-sm text-text-secondary">Only unit prices are printed. A delivery note never shows tax or totals, and never internal notes.</p>
      </SalesPanel>
      <SaveBar canManage={canManage} save={save} saved={saved} readOnlyText="You can view these settings. Changing them needs the Sales settings permission."
        onSave={() => save.mutate({
          invoiceQuantityBasis: basis, checkAvailabilityOnConfirm: checkOnConfirm, reserveStockOnConfirm: reserveOnConfirm,
          defaultWarehouseId: (inactiveDefault && warehouseId === settings.default_warehouse_id) || !warehouseId ? null : warehouseId, showPricesOnDeliveryNote: notePrices,
        })} />
    </div>
  );
}

// ------------------------------------------------------------ discount controls
export function DiscountControlsScreen() {
  return (
    <SettingsPage title="Discount Controls" description="Which discounts can be given on quotations, orders and invoices, how much a salesperson or a manager may give, and when a reason is required.">
      {({ settings }) => <DiscountForm settings={settings} />}
    </SettingsPage>
  );
}

function DiscountForm({ settings }: { settings: Settings }) {
  const canManageSettings = useHolds(SALES_PERMISSIONS.settingsManage);
  const canManageDiscounts = useHolds(SALES_PERMISSIONS.discountManageSettings);
  const canManage = canManageSettings && canManageDiscounts;
  const [saved, setSaved] = useState(false);
  const save = useSave(() => setSaved(true));
  const [lineDiscounts, setLineDiscounts] = useState(settings.allow_line_discounts);
  const [documentDiscounts, setDocumentDiscounts] = useState(settings.allow_document_discounts);
  const [percentDiscounts, setPercentDiscounts] = useState(settings.allow_percent_discounts);
  const [amountDiscounts, setAmountDiscounts] = useState(settings.allow_amount_discounts);
  const [reasonAbove, setReasonAbove] = useState(optionalPercent(settings.discount_reason_above_percent));
  const [discountLimit, setDiscountLimit] = useState(optionalPercent(settings.discount_limit_percent));
  const [managerLimit, setManagerLimit] = useState(optionalPercent(settings.discount_limit_elevated_percent));
  const touch = <T,>(setter: (value: T) => void) => (value: T) => { setSaved(false); setter(value); };
  return (
    <div className="flex flex-col gap-4">
      <SalesPanel title="Allowed discounts" description="A discount is given on a line or on the whole document, as a percentage or a fixed amount. Standard customer prices belong in price lists, not here.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Switch isSelected={lineDiscounts} onChange={touch(setLineDiscounts)} isDisabled={!canManage}>Allow line discounts</Switch>
          <Switch isSelected={documentDiscounts} onChange={touch(setDocumentDiscounts)} isDisabled={!canManage}>Allow document discounts</Switch>
          <Switch isSelected={percentDiscounts} onChange={touch(setPercentDiscounts)} isDisabled={!canManage}>Percentage discounts</Switch>
          <Switch isSelected={amountDiscounts} onChange={touch(setAmountDiscounts)} isDisabled={!canManage}>Fixed amount discounts</Switch>
        </div>
      </SalesPanel>
      <SalesPanel title="Limits and reasons" description="The limit applies to each line's total discount: its own discount plus its share of the document discount. Users who may override the limit are not restricted; a price override needs its own permission.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Salesperson maximum discount (%)" description="Leave empty for no limit." inputMode="decimal" value={discountLimit}
            onChange={(value) => touch(setDiscountLimit)(percentInput(value))} isDisabled={!canManage} />
          <TextField label="Manager maximum discount (%)" description="For users who may discount up to the higher limit. Leave empty for no limit." inputMode="decimal" value={managerLimit}
            onChange={(value) => touch(setManagerLimit)(percentInput(value))} isDisabled={!canManage} />
          <TextField label="Require a reason above (%)" description="Leave empty to never require a reason." inputMode="decimal" value={reasonAbove}
            onChange={(value) => touch(setReasonAbove)(percentInput(value))} isDisabled={!canManage} />
        </div>
      </SalesPanel>
      <SaveBar canManage={canManage} save={save} saved={saved} readOnlyText="You can view these controls. Changing them needs the Sales settings and Manage discount settings permissions."
        onSave={() => save.mutate({
          allowLineDiscounts: lineDiscounts, allowDocumentDiscounts: documentDiscounts, allowPercentDiscounts: percentDiscounts, allowAmountDiscounts: amountDiscounts,
          discountReasonAbovePercent: percentOrNull(reasonAbove), discountLimitPercent: percentOrNull(discountLimit), discountLimitElevatedPercent: percentOrNull(managerLimit),
        })} />
    </div>
  );
}
