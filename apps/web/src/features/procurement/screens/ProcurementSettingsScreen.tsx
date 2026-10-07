"use client";

// Procurement Settings, by category (?tab=): General (defaults and the company-wide settings Procurement uses), Numbering, Purchasing,
// Receiving, Matching, Returns and Billing rules, and Templates. A bill whose price differs from the order is always held for an authorised
// person to accept: there is no tolerance to configure.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Button, Checkbox, CheckboxGroup, ErrorState, PageHeader, PermissionState, Select, Tab, TabList, TabPanel, Tabs, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { useTabParam, useUnsavedChangesWarning } from "@/features/procurement/shared/navigation";
import {
  errorCode, errorMessage, getPurchaseOrderOptions, getReceivingAccess, setReceivingAccess, updatePurchasingSettings, type PurchaseOrderOptions,
} from "@/features/procurement/purchase-orders/api/purchase-orders-api";
import {
  getBillOptions, listExpenseCategories, listWithholdingSections, saveExpenseCategory, saveWithholdingSection, type ExpenseCategory,
} from "@/features/procurement/supplier-bills/api/supplier-bills-api";

export function ProcurementSettingsScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options"), queryFn: getPurchaseOrderOptions });
  if (query.isError) {
    if (errorCode(query.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to Procurement" />;
    return <ErrorState title="Could not load procurement settings" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  if (!query.data) return <LoadingState label="Loading Procurement settings" />;
  return <SettingsForm options={query.data} />;
}

const SETTINGS_TABS = ["general", "numbering", "purchasing", "receiving", "matching", "returns", "billing", "templates"] as const;

// Settings kept elsewhere that Procurement depends on.
function SettingsLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border px-3 py-2.5 transition-colors hover:bg-surface-muted">
      <span className="flex flex-col"><span className="text-sm font-medium text-text">{label}</span><span className="text-xs text-text-muted">{hint}</span></span>
      <ChevronRight className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
    </Link>
  );
}

function SettingsForm({ options }: { options: PurchaseOrderOptions }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [tab, setTab] = useTabParam(SETTINGS_TABS, "general");
  const [values, setValues] = useState(options.settings);
  const [saved, setSaved] = useState(options.settings);
  const canManage = Boolean(options.capabilities.settings);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  useUnsavedChangesWarning(dirty);
  const save = useMutation({
    mutationFn: () => updatePurchasingSettings(values),
    onSuccess: () => { setSaved(values); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); },
  });
  const set = <K extends keyof typeof values>(key: K) => (value: (typeof values)[K]) => setValues((current) => ({ ...current, [key]: value }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Procurement Settings" description="How purchasing, receiving, matching, returns and billing behave. Changes apply to documents created afterwards."
        primaryAction={canManage ? <Button variant="primary" isLoading={save.isPending} isDisabled={!dirty} onPress={() => save.mutate()}>Save changes</Button> : undefined} />
      {save.isSuccess && !dirty && <ProcAlert tone="success">Saved.</ProcAlert>}
      {save.error && <ProcAlert>{errorMessage(save.error)}</ProcAlert>}
      <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
        <TabList aria-label="Settings categories">
          <Tab id="general">General</Tab>
          <Tab id="numbering">Numbering</Tab>
          <Tab id="purchasing">Purchasing Rules</Tab>
          <Tab id="receiving">Receiving Rules</Tab>
          <Tab id="matching">Matching Rules</Tab>
          <Tab id="returns">Returns Rules</Tab>
          <Tab id="billing">Billing Rules</Tab>
          <Tab id="templates">Templates</Tab>
        </TabList>
        <TabPanel id="general">
          <div className="flex flex-col gap-4 pt-4">
            <ProcPanel title="Defaults">
              <Select label="Default receiving warehouse" isDisabled={!canManage} selectedKey={values.defaultWarehouseId ?? "none"}
                onSelectionChange={(value) => set("defaultWarehouseId")(value === "none" ? null : String(value))}
                options={[{ value: "none", label: "None" }, ...options.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))]} />
            </ProcPanel>
            <ProcPanel title="Related settings" description="Configured once for the whole company and used by Procurement.">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <SettingsLink href="/procurement/settings/categories" label="Supplier Categories" hint="Groups suppliers are classified by" />
                <SettingsLink href="/settings/finance-commercial/payment-terms" label="Payment Terms" hint="Due dates, instalments, advances and early-payment discounts" />
                <SettingsLink href="/settings/taxes" label="Tax & Accounting" hint="GST rates, TDS sections and the accounts bills post to" />
                <SettingsLink href="/settings/roles" label="Users & Permissions" hint="Who may buy, receive, bill, return and approve" />
              </div>
            </ProcPanel>
          </div>
        </TabPanel>
        <TabPanel id="numbering">
          <div className="pt-4">
            <ProcPanel title="Document numbering" description="Purchase orders, goods receipts, supplier bills, purchase returns, debit claims and vendor credits are numbered from the company's number series when they are saved; a number is never reused.">
              <SettingsLink href="/settings/numbering" label="Number series" hint="Prefixes, padding and the next number of every document type" />
            </ProcPanel>
          </div>
        </TabPanel>
        <TabPanel id="purchasing">
          <div className="pt-4">
            <ProcPanel title="Purchase orders" description="A confirmed order is the commitment to the supplier: its lines are changed by an amendment, never edited in place.">
              <Checkbox isDisabled={!canManage} isSelected={values.requireExpectedDate} onChange={set("requireExpectedDate")}>
                An expected delivery date is required to confirm an order
              </Checkbox>
            </ProcPanel>
          </div>
        </TabPanel>
        <TabPanel id="receiving">
          <div className="flex flex-col gap-4 pt-4">
            <ProcPanel title="Receiving accounting" description="Goods are received only against a confirmed purchase order; refused goods create no goods receipt.">
              <Checkbox isDisabled={!canManage} isSelected={values.postReceiptAccrual} onChange={set("postReceiptAccrual")}>
                Book received stock against Goods Received Not Invoiced (Dr Inventory, Cr GRNI); the supplier bill then clears GRNI. Needs the Inventory and GRNI account mappings.
              </Checkbox>
            </ProcPanel>
            <ReceivingWarehouses options={options} />
          </div>
        </TabPanel>
        <TabPanel id="matching">
          <div className="pt-4">
            <ProcPanel title="Billing and matching" description="What a supplier bill may cover — enforced when a bill is posted. Several bills may cover one order; only posted bills count as billed. Services are billed as ordered (or by amount for fixed-value services). A price that differs from the order is always held for an authorised person to accept.">
              <Select label="Default matching policy for new orders (fixed on each order when confirmed)" isDisabled={!canManage} selectedKey={values.billingBasis}
                onSelectionChange={(value) => set("billingBasis")(String(value) as "receipt" | "order")}
                options={[{ value: "receipt", label: "3-Way, receipt-based: once received (recommended for stock)" }, { value: "order", label: "2-Way, PO-based: as ordered, even before delivery (advance invoicing)" }]} />
              {values.billingBasis === "receipt" && (
                <Checkbox isDisabled={!canManage} isSelected={values.billHeldGoods} onChange={set("billHeldGoods")}>
                  Goods still on inspection hold may be billed (unticked: acceptance-based — only accepted or released goods)
                </Checkbox>
              )}
            </ProcPanel>
          </div>
        </TabPanel>
        <TabPanel id="returns">
          <div className="pt-4">
            <ProcPanel title="Purchase returns" description="The rules every purchase return follows.">
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text-secondary">
                <li>Goods are returned only from posted goods receipts, and never more than was received and not already returned.</li>
                <li>Posting a return moves the stock out once; reversing it brings the stock back.</li>
                <li>Billed goods are corrected by a Vendor Credit (or a Debit Claim to the supplier); unbilled goods simply reduce what may be billed.</li>
                <li>A replacement is received on a replacement purchase order linked to the return.</li>
              </ul>
            </ProcPanel>
          </div>
        </TabPanel>
        <TabPanel id="billing">
          <div className="flex flex-col gap-4 pt-4">
            <ProcPanel title="Payment terms" description="A supplier bill's due dates and instalments come from its payment term, defaulted from the order or the supplier.">
              <SettingsLink href="/settings/finance-commercial/payment-terms" label="Payment Terms" hint="Manage the company's payment terms" />
            </ProcPanel>
            <WithholdingSections />
            <ExpenseCategories />
          </div>
        </TabPanel>
        <TabPanel id="templates">
          <div className="pt-4">
            <ProcPanel title="Document templates" description="Purchase orders, debit claims and the other Procurement documents print with the company's name, logo, address and registrations.">
              <SettingsLink href="/settings/organization" label="Company profile" hint="Name, logo, address and tax registrations printed on every document" />
            </ProcPanel>
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
}

// Who may receive into each warehouse. Nobody listed: anyone allowed to receive goods.
function ReceivingWarehouses({ options }: { options: PurchaseOrderOptions }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "receiving-access");
  const query = useQuery({ queryKey: key, queryFn: getReceivingAccess });
  const save = useMutation({ mutationFn: (input: { warehouseId: string; userIds: string[] }) => setReceivingAccess(input.warehouseId, input.userIds),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) });
  const canManage = Boolean(options.capabilities.receivingAccess);
  return (
    <ProcPanel title="Receiving warehouses" description="Who may post goods receipts into each warehouse. With nobody ticked, anyone allowed to receive goods may.">
      {save.error && <ProcAlert>{errorMessage(save.error)}</ProcAlert>}
      {(query.data ?? []).map((warehouse) => (
        <CheckboxGroup key={warehouse.warehouseId} label={warehouse.name} orientation="horizontal" isDisabled={!canManage} value={warehouse.userIds}
          onChange={(userIds) => save.mutate({ warehouseId: warehouse.warehouseId, userIds })}>
          {options.buyers.map((user) => <Checkbox key={user.id} value={user.id}>{user.name}</Checkbox>)}
        </CheckboxGroup>
      ))}
    </ProcPanel>
  );
}

// Expense categories for direct bills (rent, electricity, internet, ...): each posts to one expense or asset account, with an optional default tax and HSN/SAC.
// Changing a category's account affects future bills only; posted bills keep their journals.
function ExpenseCategories() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "expense-categories");
  const query = useQuery({ queryKey: key, queryFn: listExpenseCategories });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill-options"), queryFn: getBillOptions, staleTime: 60_000 });
  const blank = { code: "", name: "", accountId: "", defaultTaxCategoryId: "none", defaultHsnSac: "" };
  const [draft, setDraft] = useState(blank);
  const field = (name: keyof typeof blank) => (value: string) => setDraft((current) => ({ ...current, [name]: value }));
  const save = useMutation({ mutationFn: (input: Record<string, unknown>) => saveExpenseCategory(input),
    onSuccess: () => { setDraft(blank); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); } });
  const toggle = (category: ExpenseCategory) => save.mutate({ id: category.id, code: category.code, name: category.name, accountId: category.accountId,
    defaultTaxCategoryId: category.defaultTaxCategoryId, defaultHsnSac: category.defaultHsnSac, status: category.status === "active" ? "inactive" : "active" });
  const manage = Boolean(options.data?.capabilities.categories);
  if (query.isError) return null;
  return (
    <ProcPanel title="Expense categories" description="Used on direct supplier bills. Each category posts to its account; stock and inventory accounts are not allowed — stock is bought on a purchase order.">
      {save.error && <ProcAlert>{errorMessage(save.error)}</ProcAlert>}
      <ul className="flex flex-col divide-y divide-border text-sm">
        {(query.data ?? []).map((category) => (
          <li key={category.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><span className="font-medium">{category.code}</span> · {category.name} → {category.account ?? "—"}{category.defaultHsnSac ? ` · HSN/SAC ${category.defaultHsnSac}` : ""}{category.status !== "active" ? " (inactive)" : ""}</span>
            {manage && <Button size="compact" variant="ghost" onPress={() => toggle(category)}>{category.status === "active" ? "Deactivate" : "Activate"}</Button>}
          </li>
        ))}
        {!query.data?.length && <li className="py-2 text-text-muted">No expense categories yet.</li>}
      </ul>
      {manage && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <TextField label="Code" value={draft.code} onChange={field("code")} placeholder="RENT" />
          <TextField label="Name" value={draft.name} onChange={field("name")} placeholder="Office rent" />
          <Select label="Account" selectedKey={draft.accountId || null} onSelectionChange={(value) => field("accountId")(String(value))}
            options={(options.data?.accounts ?? []).map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }))} />
          <Select label="Default tax" selectedKey={draft.defaultTaxCategoryId} onSelectionChange={(value) => field("defaultTaxCategoryId")(String(value))}
            options={[{ value: "none", label: "None" }, ...(options.data?.taxCategories ?? []).map((category) => ({ value: category.id, label: category.name }))]} />
          <TextField label="Default HSN / SAC" value={draft.defaultHsnSac} onChange={field("defaultHsnSac")} />
          <div className="flex items-end"><Button variant="secondary" isLoading={save.isPending} isDisabled={!draft.code || !draft.name || !draft.accountId}
            onPress={() => save.mutate({ ...draft, defaultTaxCategoryId: draft.defaultTaxCategoryId === "none" ? null : draft.defaultTaxCategoryId, defaultHsnSac: draft.defaultHsnSac || null })}>Add category</Button></div>
        </div>
      )}
    </ProcPanel>
  );
}

// TDS / withholding sections of the shared tax set-up: the rate withheld from a supplier's bill (on its taxable value).
function WithholdingSections() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "withholding-sections");
  const query = useQuery({ queryKey: key, queryFn: listWithholdingSections });
  const [draft, setDraft] = useState({ code: "", name: "", rate: "" });
  const save = useMutation({ mutationFn: (input: Record<string, unknown>) => saveWithholdingSection(input),
    onSuccess: () => { setDraft({ code: "", name: "", rate: "" }); void queryClient.invalidateQueries({ queryKey: key }); } });
  return (
    <ProcPanel title="TDS sections" description="Withheld from supplier bills on their taxable value. A supplier carries its usual section; a bill may use another or none. Managed by whoever manages tax rates.">
      {save.error && <ProcAlert>{errorMessage(save.error)}</ProcAlert>}
      <ul className="flex flex-col divide-y divide-border text-sm">
        {(query.data ?? []).map((section) => (
          <li key={section.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><span className="font-medium">{section.code}</span> · {section.name} · {Number(section.rate)}%{section.status !== "active" ? " (inactive)" : ""}</span>
            <Button size="compact" variant="ghost" onPress={() => save.mutate({ id: section.id, code: section.code, name: section.name, rate: section.rate, status: section.status === "active" ? "inactive" : "active" })}>
              {section.status === "active" ? "Deactivate" : "Activate"}
            </Button>
          </li>
        ))}
        {!query.data?.length && <li className="py-2 text-text-muted">No TDS sections yet.</li>}
      </ul>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <TextField label="Section" value={draft.code} onChange={(value) => setDraft((current) => ({ ...current, code: value }))} placeholder="194C" />
        <TextField label="Description" value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} placeholder="Contractors" />
        <TextField label="Rate %" inputMode="decimal" value={draft.rate} onChange={(value) => setDraft((current) => ({ ...current, rate: value }))} />
        <div className="flex items-end"><Button variant="secondary" isLoading={save.isPending} isDisabled={!draft.code || !draft.name || !draft.rate} onPress={() => save.mutate(draft)}>Add section</Button></div>
      </div>
    </ProcPanel>
  );
}
