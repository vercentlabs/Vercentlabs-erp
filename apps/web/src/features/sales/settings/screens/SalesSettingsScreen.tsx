"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, EnterpriseDataGrid, ErrorState, NumberField, PageHeader, PermissionState, Select, Switch, TextField } from "@vercentlabs/design-system";
import type { ColumnDef } from "@tanstack/react-table";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request, SalesApiError } from "@/features/sales/shared/http";
import { SalesAlert, SalesPanel } from "@/features/sales/shared/SalesUi";
import { listSalesPriceLists } from "@/features/sales/price-lists/api/price-lists-api";

type Settings = {
  seller_state_code: string | null;
  default_quote_validity_days: number;
  quotation_approval_amount: string | number;
  quotation_approval_discount: string | number;
  minimum_margin_percent: string | number;
  order_approval_amount: string | number;
  allow_direct_orders: boolean;
  invoice_quantity_basis: "ordered" | "fulfilled";
  default_price_list_id?: string | null;
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
  return (
    <div className="flex flex-col gap-4">
      <SettingsForm settings={query.data} />
      <ApprovalDelegations />
    </div>
  );
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
  const [defaultPriceListId, setDefaultPriceListId] = useState(settings.default_price_list_id ?? "");
  const priceLists = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-lists"), queryFn: () => listSalesPriceLists().then((r) => r.rows) });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      request<{ settings: Settings }>("/settings", {
        method: "PUT",
        body: JSON.stringify({ sellerStateCode: state || null, defaultQuoteValidityDays: validity, quotationApprovalAmount: quoteAmount, quotationApprovalDiscount: quoteDiscount, minimumMarginPercent: margin, orderApprovalAmount: orderAmount, allowDirectOrders: direct, invoiceQuantityBasis: basis, defaultPriceListId: defaultPriceListId || null }),
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
            label="Default price list"
            options={[{ value: "", label: "None (item list prices)" }, ...(priceLists.data ?? []).filter((list) => list.status === "active").map((list) => ({ value: list.id, label: `${list.name} (${list.currency_code})` }))]}
            selectedKey={defaultPriceListId}
            onSelectionChange={(key) => touch(setDefaultPriceListId)(String(key ?? ""))}
            isDisabled={!canManage}
          />
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

type Delegation = { id: string; delegator_name: string; delegate_name: string; starts_on: string; ends_on: string; reason: string; status: string; in_effect: boolean };

// F041 -- while an approver is away, new approval requests assigned to them go
// to their delegate for the dates given. Past decisions are never re-routed.
function ApprovalDelegations() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "approval-delegations");
  const list = useQuery({ queryKey: key, queryFn: () => request<{ rows: Delegation[] }>("/approval-delegations").then((r) => r.rows) });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options) });
  const [adding, setAdding] = useState(false);
  const [delegatorUserId, setDelegatorUserId] = useState(workspace.userId ?? "");
  const [delegateUserId, setDelegateUserId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => request("/approval-delegations", { method: "POST", body: JSON.stringify({ delegatorUserId, delegateUserId, startsOn, endsOn, reason }) }),
    onSuccess: () => { setAdding(false); setDelegateUserId(""); setReason(""); refresh(); },
  });
  const revoke = useMutation({ mutationFn: (id: string) => request(`/approval-delegations/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const users = (options.data?.users ?? []).map((user) => ({ value: user.id, label: user.full_name }));
  const columns: ColumnDef<Delegation, unknown>[] = [
    { id: "from", header: "Approver", accessorKey: "delegator_name" },
    { id: "to", header: "Delegated to", accessorKey: "delegate_name" },
    { id: "when", header: "Dates", accessorFn: (row) => `${row.starts_on} → ${row.ends_on}` },
    { id: "reason", header: "Reason", accessorKey: "reason" },
    { id: "status", header: "Status", accessorFn: (row) => (row.status === "revoked" ? "Revoked" : row.in_effect ? "In effect" : row.ends_on < new Date().toISOString().slice(0, 10) ? "Ended" : "Scheduled") },
  ];
  const error = create.error ?? revoke.error;
  return (
    <SalesPanel title="Approval delegation" description="While an approver is away, new quotation and order approvals assigned to them go to the person they delegate to. The routing is recorded on each document.">
      {error && <SalesAlert>{error instanceof SalesApiError ? error.message : "The delegation could not be saved."}</SalesAlert>}
      <EnterpriseDataGrid<Delegation>
        aria-label="Approval delegations"
        columns={columns}
        data={list.data ?? []}
        getRowId={(row) => row.id}
        density="compact"
        state={list.isLoading ? "loading" : list.data?.length ? "ready" : "empty"}
        emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No delegations yet.</p>}
        rowActions={(row) => (row.status === "active" ? <Button variant="ghost" size="compact" onPress={() => revoke.mutate(row.id)}>Revoke</Button> : null)}
      />
      <div className="mt-3">
        <Button variant="secondary" onPress={() => setAdding(true)}>
          Delegate approvals
        </Button>
      </div>
      {adding && (
        <Dialog isOpen onOpenChange={(open) => !open && setAdding(false)} title="Delegate approvals">
          <div className="flex flex-col gap-3">
            {create.error && <SalesAlert>{create.error instanceof SalesApiError ? create.error.message : "The delegation could not be saved."}</SalesAlert>}
            <Select label="Approver who is away" options={users} selectedKey={delegatorUserId || null} onSelectionChange={(k) => setDelegatorUserId(String(k ?? ""))} />
            <Select label="Delegate to" options={users.filter((u) => u.value !== delegatorUserId)} selectedKey={delegateUserId || null} onSelectionChange={(k) => setDelegateUserId(String(k ?? ""))} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="From" type="date" isRequired value={startsOn} onChange={setStartsOn} />
              <TextField label="Until" type="date" isRequired value={endsOn} onChange={setEndsOn} />
            </div>
            <TextField label="Reason" isRequired value={reason} onChange={setReason} placeholder="e.g. On leave for Diwali" />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setAdding(false)}>
                Close
              </Button>
              <Button variant="primary" onPress={() => create.mutate()} isLoading={create.isPending} isDisabled={!delegatorUserId || !delegateUserId || !startsOn || !endsOn || reason.trim().length < 5}>
                Save delegation
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </SalesPanel>
  );
}
