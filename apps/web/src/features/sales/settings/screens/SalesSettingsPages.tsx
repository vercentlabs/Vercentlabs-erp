"use client";

// The pages inside Sales Settings: Quotation & Order Rules, Fulfillment,
// Discount Controls, Credit Control and GST & e-invoice (Sales plan). Each reads the organization's Sales settings and saves
// only its own fields; Payment Terms are shared settings (Settings → Payment Terms). Viewing needs
// sales.view, changing needs sales.settings.manage (and, for discounts,
// sales.discount.manage_settings). The server checks both again.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, NumberField, PageHeader, PermissionState, Select, Switch, TextArea, TextField } from "@vercentlabs/design-system";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { post, request, SalesApiError } from "@/features/sales/shared/http";
import { Notice, Panel } from "@/shared/ui/Panel";
import { GspConnectionsPanel } from "../components/GspConnectionsPanel";
import { LutPanel } from "../components/LutPanel";
import { OnlinePaymentsPanel } from "../components/OnlinePaymentsPanel";
import { CustomerPortalPanel } from "../components/CustomerPortalPanel";

type Settings = {
  default_quote_validity_days: number;
  quotation_approval_amount: string | number;
  quotation_approval_discount: string | number;
  minimum_margin_percent: string | number;
  allow_direct_orders: boolean;
  allow_lines_without_item?: boolean;
  reserve_stock_on_confirm: boolean;
  require_customer_po: boolean;
  credit_control?: "off" | "warn" | "block";
  credit_overdue_days?: number | null;
  unassigned_customers_visible?: boolean;
  einvoice_on_post?: boolean;
  receipt_vouchers_from?: string | null;
  order_on_online_acceptance?: boolean;
  document_reply_to?: string | null;
  einvoice_30_day_limit?: boolean;
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
      {!canManage && <Notice tone="info">{readOnlyText}</Notice>}
      {save.error && <Notice>{save.error instanceof SalesApiError ? save.error.message : "Settings could not be saved."}</Notice>}
      {saved && <Notice tone="success">Saved. The change applies to documents from now on.</Notice>}
      {canManage && <div><Button variant="primary" isLoading={save.isPending} onPress={onSave}>Save</Button></div>}
    </div>
  );
}

// --------------------------------------------------- quotation & order rules
export function QuotationOrderRulesScreen() {
  return (
    <SettingsPage title="Quotation & Order Rules" description="Quotation approval and validity, and what an order needs before it is confirmed.">
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
  const [unassigned, setUnassigned] = useState(Boolean(settings.unassigned_customers_visible));
  const [typedLines, setTypedLines] = useState(settings.allow_lines_without_item !== false);
  const [orderOnAccept, setOrderOnAccept] = useState(Boolean(settings.order_on_online_acceptance));
  const [replyTo, setReplyTo] = useState(settings.document_reply_to ?? "");
  const touch = <T,>(setter: (value: T) => void) => (value: T) => { setSaved(false); setter(value); };
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Quotation approval" description="Someone other than the author must approve when any trigger below is met. Use 0 to switch one off.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField label="Approval above amount" value={quoteAmount} onChange={touch(setQuoteAmount)} minValue={0} step={0.01} isDisabled={!canManage} />
          <NumberField label="Approval above discount (%)" value={quoteDiscount} onChange={touch(setQuoteDiscount)} minValue={0} maxValue={100} step={1} isDisabled={!canManage} />
          <NumberField label="Approval below margin (%)" value={margin} onChange={touch(setMargin)} minValue={-100} maxValue={100} step={1} isDisabled={!canManage} />
        </div>
      </Panel>
      <Panel title="Quotations">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField label="Quotation validity (days)" value={validity} onChange={touch(setValidity)} minValue={1} maxValue={365} step={1} isDisabled={!canManage} />
        </div>
        <TextArea label="Standard terms and conditions for quotations" description="Copied onto each new quotation, where it can be changed. Printed on the quotation."
          value={quotationTerms} onChange={touch(setQuotationTerms)} isDisabled={!canManage} />
        <Switch isSelected={orderOnAccept} onChange={touch(setOrderOnAccept)} isDisabled={!canManage}>Make the sales order when the customer accepts online</Switch>
      </Panel>
      <Panel title="Sales orders" description="Orders are confirmed by someone with the Confirm sales orders permission; there is no order approval.">
        <Switch isSelected={direct} onChange={touch(setDirect)} isDisabled={!canManage}>Allow orders without a quotation</Switch>
        <Switch isSelected={requirePo} onChange={touch(setRequirePo)} isDisabled={!canManage}>Require the customer&apos;s PO number before an order is confirmed</Switch>
        <Switch isSelected={requireDelivery} onChange={touch(setRequireDelivery)} isDisabled={!canManage}>Require a requested delivery date before an order is confirmed</Switch>
      </Panel>
      <Panel title="Lines" description="A line with just a name, price, HSN/SAC and GST, for things not in the catalogue.">
        <Switch isSelected={typedLines} onChange={touch(setTypedLines)} isDisabled={!canManage}>Allow lines without a catalogue product</Switch>
      </Panel>
      <Panel title="Replies to document emails" description="Customers' replies to quotations, orders and invoices go here and join the document.">
        <div className="sm:max-w-md">
          <TextField label="Reply-to address" type="email" value={replyTo} onChange={touch(setReplyTo)} isDisabled={!canManage} placeholder="For example: sales-replies@yourcompany.com"
            description="Point this mailbox at an inbound address set to Sales replies (Settings, Integrations)." />
        </div>
      </Panel>
      <OnlinePaymentsPanel canManage={canManage} />
      <CustomerPortalPanel canManage={canManage} />
      <Panel title="Customers" description="A salesperson who sees only their own customers sees those they are the salesperson of or added.">
        <Switch isSelected={unassigned} onChange={touch(setUnassigned)} isDisabled={!canManage}>Every salesperson also sees customers with no salesperson</Switch>
      </Panel>
      <SaveBar canManage={canManage} save={save} saved={saved} readOnlyText="You can view these rules. Changing them needs the Sales settings permission."
        onSave={() => save.mutate({
          defaultQuoteValidityDays: validity, quotationApprovalAmount: quoteAmount, quotationApprovalDiscount: quoteDiscount, minimumMarginPercent: margin,
          defaultQuotationTerms: quotationTerms, allowDirectOrders: direct, requireCustomerPo: requirePo, requireRequestedDeliveryDate: requireDelivery,
          unassignedCustomersVisible: unassigned, allowLinesWithoutItem: typedLines, orderOnOnlineAcceptance: orderOnAccept, documentReplyTo: replyTo.trim() || null,
        })} />
    </div>
  );
}

// ---------------------------------------------------------------- fulfillment
export function FulfillmentSettingsScreen() {
  return (
    <SettingsPage title="Delivery Settings" description="How orders are billed, when stock is kept aside, and which warehouse orders start from.">
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
      <Panel title="Invoicing">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Invoice based on" description="Sales Order: anything ordered can be invoiced. Delivery: goods only once delivered (services as ordered)."
            options={[{ value: "ordered", label: "Bill on order" }, { value: "fulfilled", label: "Bill on dispatch" }]}
            selectedKey={basis} onSelectionChange={(key) => touch(setBasis)(String(key ?? "ordered"))} isDisabled={!canManage} />
        </div>
      </Panel>
      <Panel title="Availability and stock kept aside" description="Checks stock on hand that is not kept aside. Checking never blocks an order.">
        <Switch isSelected={checkOnConfirm} onChange={touch(setCheckOnConfirm)} isDisabled={!canManage}>Check availability when an order is confirmed</Switch>
        <Switch isSelected={reserveOnConfirm} onChange={touch(setReserveOnConfirm)} isDisabled={!canManage}>Keep available stock aside when an order is confirmed</Switch>
      </Panel>
      <Panel title="Default warehouse" description="Where new orders' goods come from. It can be changed on each order.">
        {inactiveDefault && <Notice tone="warning">The warehouse chosen here is no longer active, so new orders start without one.</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Default warehouse" options={[{ value: "", label: "None" }, ...warehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))]}
            selectedKey={inactiveDefault ? "" : warehouseId} onSelectionChange={(key) => touch(setWarehouseId)(String(key ?? ""))} isDisabled={!canManage} />
        </div>
      </Panel>
      <Panel title="Delivery note" description="Deliveries are dispatched by sales managers and the warehouse; stock is issued at dispatch.">
        <Switch isSelected={notePrices} onChange={touch(setNotePrices)} isDisabled={!canManage}>Show prices on the delivery note</Switch>
        <p className="text-sm text-text-secondary">Only unit prices are printed. A delivery note never shows tax or totals, and never internal notes.</p>
      </Panel>
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
    <SettingsPage title="Discount limits" description="Which discounts can be given, how much each person may give, and when a reason is needed.">
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
      <Panel title="Allowed discounts" description="Discounts on a line or the whole document. Put standard customer prices in price lists.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Switch isSelected={lineDiscounts} onChange={touch(setLineDiscounts)} isDisabled={!canManage}>Allow line discounts</Switch>
          <Switch isSelected={documentDiscounts} onChange={touch(setDocumentDiscounts)} isDisabled={!canManage}>Allow document discounts</Switch>
          <Switch isSelected={percentDiscounts} onChange={touch(setPercentDiscounts)} isDisabled={!canManage}>Percentage discounts</Switch>
          <Switch isSelected={amountDiscounts} onChange={touch(setAmountDiscounts)} isDisabled={!canManage}>Fixed amount discounts</Switch>
        </div>
      </Panel>
      <Panel title="Limits and reasons" description="The limit covers each line's own discount plus its share of the document discount.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Salesperson maximum discount (%)" description="Leave empty for no limit." inputMode="decimal" value={discountLimit}
            onChange={(value) => touch(setDiscountLimit)(percentInput(value))} isDisabled={!canManage} />
          <TextField label="Manager maximum discount (%)" description="For users who may discount up to the higher limit. Leave empty for no limit." inputMode="decimal" value={managerLimit}
            onChange={(value) => touch(setManagerLimit)(percentInput(value))} isDisabled={!canManage} />
          <TextField label="Require a reason above (%)" description="Leave empty to never require a reason." inputMode="decimal" value={reasonAbove}
            onChange={(value) => touch(setReasonAbove)(percentInput(value))} isDisabled={!canManage} />
        </div>
      </Panel>
      <SaveBar canManage={canManage} save={save} saved={saved} readOnlyText="You can view these controls. Changing them needs the Sales settings and Manage discount settings permissions."
        onSave={() => save.mutate({
          allowLineDiscounts: lineDiscounts, allowDocumentDiscounts: documentDiscounts, allowPercentDiscounts: percentDiscounts, allowAmountDiscounts: amountDiscounts,
          discountReasonAbovePercent: percentOrNull(reasonAbove), discountLimitPercent: percentOrNull(discountLimit), discountLimitElevatedPercent: percentOrNull(managerLimit),
        })} />
    </div>
  );
}

// ------------------------------------------------------------- credit control
// Setup › Credit control (Sales plan): what happens to an order over the customer's limit or with bills overdue too long. Hold is the
// approval: the order waits in Credit hold until someone who can release credit confirms it with a reason (the salesperson can ask).
export function CreditControlScreen() {
  return (
    <SettingsPage title="Credit Control" description="What happens when an order takes a customer over their credit limit, or bills are overdue too long.">
      {({ settings }) => <CreditControlForm settings={settings} />}
    </SettingsPage>
  );
}

function CreditControlForm({ settings }: { settings: Settings }) {
  const canManage = useHolds(SALES_PERMISSIONS.settingsManage);
  const [saved, setSaved] = useState(false);
  const save = useSave(() => setSaved(true));
  const [creditControl, setCreditControl] = useState<string>(settings.credit_control ?? "block");
  const [overdueDays, setOverdueDays] = useState<number>(settings.credit_overdue_days ?? NaN);
  const touch = <T,>(setter: (value: T) => void) => (value: T) => { setSaved(false); setter(value); };
  return (
    <div className="flex flex-col gap-4">
      <Panel title="When an order goes over the limit" description="Set each customer's limit on the customer (0 means no limit). Used credit includes confirmed orders not yet billed.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="An order over the customer's credit limit" selectedKey={creditControl} onSelectionChange={(key) => touch(setCreditControl)(String(key ?? "block"))} isDisabled={!canManage}
            options={[
              { value: "block", label: "Is held until a manager releases it (approval)" },
              { value: "warn", label: "Is confirmed with a warning" },
              { value: "off", label: "Is not checked" },
            ]} />
          <NumberField label="Also hold orders when a bill is overdue more than (days)" description="Leave empty to not check overdue bills." value={overdueDays}
            onChange={touch(setOverdueDays)} minValue={0} maxValue={3650} step={1} isDisabled={!canManage || creditControl === "off"} />
        </div>
        <p className="text-sm text-text-secondary">A held order shows in Sales Orders › Waiting for credit approval and on the home. The salesperson can ask for it to be released; whoever has
          the Release credit permission confirms it and gives the reason, which is kept on the order&apos;s history.</p>
      </Panel>
      <SaveBar canManage={canManage} save={save} saved={saved} readOnlyText="You can view these rules. Changing them needs the Sales settings permission."
        onSave={() => save.mutate({ creditControl: creditControl as "off" | "warn" | "block", creditOverdueDays: Number.isFinite(overdueDays) ? overdueDays : null })} />
    </div>
  );
}

// ----------------------------------------------------------- GST & e-invoice
// Setup › GST & e-invoice (Sales plan): the IRN when an invoice is posted (once the GSP is tested), and the 30-day reporting limit.
export function GstEinvoiceScreen() {
  return (
    <SettingsPage title="GST & e-invoice" description="E-invoices (IRN) for invoices, credit notes and debit notes to registered customers, through the company's GST Suvidha Provider.">
      {({ settings }) => <GstEinvoiceForm settings={settings} />}
    </SettingsPage>
  );
}

function GstEinvoiceForm({ settings }: { settings: Settings }) {
  const canManage = useHolds(SALES_PERMISSIONS.settingsManage);
  const [saved, setSaved] = useState(false);
  const save = useSave(() => setSaved(true));
  const [onPost, setOnPost] = useState(Boolean(settings.einvoice_on_post));
  const [limit, setLimit] = useState(Boolean(settings.einvoice_30_day_limit));
  const touch = <T,>(setter: (value: T) => void) => (value: T) => { setSaved(false); setter(value); };
  return (
    <div className="flex flex-col gap-4">
      <GspConnectionsPanel />
      <Panel title="E-invoice when finalised" description="Switch on once the GSP is tested. Without one, enter the IRN on the invoice's GST tab.">
        <Switch isSelected={onPost} onChange={touch(setOnPost)} isDisabled={!canManage}>Generate the IRN when an invoice, credit note or debit note to a registered customer is finalised</Switch>
        <p className="text-sm text-text-secondary">If the GSP refuses, the document stays final and its GST tab shows why, to retry.</p>
      </Panel>
      <ReceiptVouchersSetting from={settings.receipt_vouchers_from ?? null} canManage={canManage} />
      <LutPanel canManage={canManage} />
      <Panel title="30-day reporting limit" description="Since 1 April 2025, companies with ₹10 crore turnover or more must report invoices within 30 days.">
        <Switch isSelected={limit} onChange={touch(setLimit)} isDisabled={!canManage}>Our turnover is ₹10 crore or more: warn on documents nearing 30 days without an IRN</Switch>
      </Panel>
      <SaveBar canManage={canManage} save={save} saved={saved} readOnlyText="You can view these settings. Changing them needs the Sales settings permission."
        onSave={() => save.mutate({ einvoiceOnPost: onPost, einvoice30DayLimit: limit })} />
    </div>
  );
}

// GST on advances (Sales report Phase 2): receipt vouchers from a date, so payments before it are never touched. Saved on its own.
function ReceiptVouchersSetting({ from, canManage }: { from: string | null; canManage: boolean }) {
  const [on, setOn] = useState(Boolean(from));
  const [date, setDate] = useState(from ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  const save = useMutation({ mutationFn: (value: string | null) => post("/settings/receipt-vouchers", { from: value }) });
  return (
    <Panel title="Receipt vouchers for advances" description="For services: GST is paid on an advance when it is received, on a receipt voucher.">
      {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      <Switch isSelected={on} isDisabled={!canManage || save.isPending} onChange={(value) => { setOn(value); save.mutate(value ? date : null); }}>Issue receipt vouchers for advances</Switch>
      {on && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <TextField label="From" type="date" value={date} onChange={setDate} isDisabled={!canManage} description="Payments before this date are not touched." />
          <Button variant="secondary" isDisabled={!canManage || !date} isLoading={save.isPending} onPress={() => save.mutate(date)}>Save date</Button>
        </div>
      )}
      {save.isSuccess && <p className="text-sm text-success">Saved.</p>}
    </Panel>
  );
}
