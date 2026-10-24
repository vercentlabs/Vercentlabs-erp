"use client";

// Procurement Settings, by category (?tab=): General (defaults and the company-wide settings Procurement uses), Numbering, Purchasing,
// Receiving, Matching, Returns and Billing rules, and Templates. A bill whose price differs from the order is always held for an authorised
// person to accept: there is no tolerance to configure.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { ReceiptRemindersPanel } from "./ReceiptRemindersPanel";
import { DepartmentsPanel } from "./DepartmentsPanel";
import { Button, Checkbox, ErrorState, PageHeader, PermissionState, Select, Tab, TabList, TabPanel, Tabs, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useTabParam, useUnsavedChangesWarning } from "@/features/procurement/shared/navigation";
import {
  errorCode, errorMessage, getPurchaseOrderOptions, updatePurchasingSettings, type PurchaseOrderOptions,
} from "@/features/procurement/purchase-orders/api/purchase-orders-api";
import {
  getBillOptions, listExpenseCategories, listWithholdingSections, saveExpenseCategory, saveWithholdingSection, type ExpenseCategory,
} from "@/features/procurement/supplier-bills/api/supplier-bills-api";
import { Notice, Panel } from "@/shared/ui/Panel";

export function ProcurementSettingsScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options"), queryFn: () => getPurchaseOrderOptions() });
  if (query.isError) {
    if (errorCode(query.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to Procurement" />;
    return <ErrorState title="Could not load procurement settings" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  if (!query.data) return <LoadingState label="Loading Procurement settings" />;
  return <SettingsForm options={query.data} />;
}

// Procurement plan Phase 1: Defaults, Numbering, Approvals, Matching and TDS have tabs of their own.
const SETTINGS_TABS = ["general", "numbering", "approvals", "purchasing", "receiving", "matching", "returns", "billing", "tds", "templates"] as const;

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
      <PageHeader title="Procurement Setup" description="How purchasing, receiving, matching, returns and billing behave. Changes apply to documents created afterwards."
        primaryAction={canManage ? <Button variant="primary" isLoading={save.isPending} isDisabled={!dirty} onPress={() => save.mutate()}>Save changes</Button> : undefined} />
      {save.isSuccess && !dirty && <Notice tone="success">Saved.</Notice>}
      {save.error && <Notice>{errorMessage(save.error)}</Notice>}
      <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
        <TabList aria-label="Settings categories">
          <Tab id="general">Defaults</Tab>
          <Tab id="numbering">Numbering</Tab>
          <Tab id="approvals">Approvals</Tab>
          <Tab id="purchasing">Purchasing Rules</Tab>
          <Tab id="receiving">Receiving Rules</Tab>
          <Tab id="matching">Matching Rules</Tab>
          <Tab id="returns">Returns Rules</Tab>
          <Tab id="billing">Billing Rules</Tab>
          <Tab id="tds">TDS</Tab>
          <Tab id="templates">Templates</Tab>
        </TabList>
        <TabPanel id="general">
          <div className="flex flex-col gap-4 pt-4">
            <Panel title="Defaults">
              <Select label="Default receiving warehouse" isDisabled={!canManage} selectedKey={values.defaultWarehouseId ?? "none"}
                onSelectionChange={(value) => set("defaultWarehouseId")(value === "none" ? null : String(value))}
                options={[{ value: "none", label: "None" }, ...options.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))]} />
            </Panel>
            <Panel title="Related settings" description="Configured once for the whole company and used by Procurement.">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <SettingsLink href="/procurement/settings/categories" label="Supplier Categories" hint="Groups suppliers are classified by" />
                <SettingsLink href="/settings/finance-commercial/payment-terms" label="Payment Terms" hint="Due dates, payments due, advances and early-payment discounts" />
                <SettingsLink href="/settings/taxes" label="Tax & Accounting" hint="GST rates, TDS sections and the accounts bills are recorded in" />
                <SettingsLink href="/settings/roles" label="Users & Permissions" hint="Who may buy, receive, bill, return and approve" />
              </div>
            </Panel>
          </div>
        </TabPanel>
        <TabPanel id="numbering">
          <div className="pt-4">
            <Panel title="Document numbering" description="Every Procurement document gets the next number from the company's series when saved; no number is reused.">
              <SettingsLink href="/settings/numbering" label="Number series" hint="Prefixes, padding and the next number of every document type" />
            </Panel>
          </div>
        </TabPanel>
        <TabPanel id="approvals">
          <div className="pt-4">
            <Panel title="Approvals" description="Orders over a value need each level's approval before confirming; approvers decide in Approvals.">
              <div className="grid gap-2 sm:grid-cols-2">
                <SettingsLink href="/settings/approval-rules" label="Approval rules" hint="Who approves purchase orders, by value and level" />
                <SettingsLink href="/approvals" label="Approvals inbox" hint="What is waiting for a decision" />
              </div>
            </Panel>
          </div>
        </TabPanel>
        <TabPanel id="purchasing">
          <div className="flex flex-col gap-4 pt-4">
            <Panel title="Purchase orders" description="A confirmed order is changed with Change the order, never edited in place.">
              <Checkbox isDisabled={!canManage} isSelected={values.requireExpectedDate} onChange={set("requireExpectedDate")}>
                An expected delivery date is required to confirm an order
              </Checkbox>
            </Panel>
            <DepartmentsPanel canManage={canManage} people={options.buyers} />
            <Panel title="Indents and RFQs" description="Both are optional: a purchase order stays the usual way to start buying.">
              <div className="flex flex-col gap-3">
                <Checkbox isDisabled={!canManage} isSelected={values.useIndents}
                  onChange={(on) => setValues((current) => ({ ...current, useIndents: on, reorderCreates: on ? current.reorderCreates : "purchase_order" }))}>
                  Use purchase indents — departments and the store ask for items; the head approves before the buyer orders
                </Checkbox>
                <Checkbox isDisabled={!canManage} isSelected={values.useRfqs} onChange={set("useRfqs")}>
                  Use RFQs — ask several suppliers for prices and compare them before ordering
                </Checkbox>
                <Select label="When stock falls below its reorder level" isDisabled={!canManage || !values.useIndents} selectedKey={values.reorderCreates}
                  onSelectionChange={(value) => set("reorderCreates")(String(value) as "purchase_order" | "indent")}
                  options={[{ value: "purchase_order", label: "Open a draft purchase order" }, { value: "indent", label: "Raise an indent for approval" }]} className="sm:w-96" />
              </div>
            </Panel>
          </div>
        </TabPanel>
        <TabPanel id="receiving">
          <div className="flex flex-col gap-4 pt-4">
            <ReceiptRemindersPanel canManage={canManage} />
            <Panel title="Goods without an order" description="Lets the store receive goods without an order; an order is raised with the receipt, and approval rules still apply.">
              <Checkbox isDisabled={!canManage} isSelected={values.allowReceiptWithoutOrder !== false} onChange={set("allowReceiptWithoutOrder")}>
                Allow receiving goods without a purchase order
              </Checkbox>
            </Panel>
            <Panel title="Receiving accounting" description="Refused goods create no goods receipt.">
              <Checkbox isDisabled={!canManage} isSelected={values.postReceiptAccrual} onChange={set("postReceiptAccrual")}>
                Book received stock as owed before the bill arrives (goods received, bill not yet received); the bill then clears it. Needs the Inventory and goods-received account mappings.
              </Checkbox>
            </Panel>
          </div>
        </TabPanel>
        <TabPanel id="matching">
          <div className="pt-4">
            <Panel title="Billing and matching" description="What a bill may cover, checked when it is finalised. A different price always waits for approval.">
              <Select label="Default how bills are checked for new orders (fixed on each order when confirmed)" isDisabled={!canManage} selectedKey={values.billingBasis}
                onSelectionChange={(value) => set("billingBasis")(String(value) as "receipt" | "order")}
                options={[{ value: "receipt", label: "Order and goods received, receipt-based: once received (recommended for stock)" }, { value: "order", label: "Order only, PO-based: as ordered, even before delivery (advance invoicing)" }]} />
              {values.billingBasis === "receipt" && (
                <Checkbox isDisabled={!canManage} isSelected={values.billHeldGoods} onChange={set("billHeldGoods")}>
                  Goods still on inspection hold may be billed (unticked: acceptance-based — only accepted or released goods)
                </Checkbox>
              )}
            </Panel>
          </div>
        </TabPanel>
        <TabPanel id="returns">
          <div className="pt-4">
            <Panel title="Purchase returns" description="The rules every purchase return follows.">
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text-secondary">
                <li>Goods are returned only from final goods receipts, and never more than was received and not already returned.</li>
                <li>Finalising a return moves the stock out once; reversing it brings the stock back.</li>
                <li>Billed goods are corrected by a Supplier Credit Note (or a Debit Note to the supplier); unbilled goods simply reduce what may be billed.</li>
                <li>A replacement is received on a replacement purchase order linked to the return.</li>
              </ul>
            </Panel>
          </div>
        </TabPanel>
        <TabPanel id="billing">
          <div className="flex flex-col gap-4 pt-4">
            <Panel title="Payment terms" description="A supplier bill's due dates and payments due come from its payment term, defaulted from the order or the supplier.">
              <SettingsLink href="/settings/finance-commercial/payment-terms" label="Payment Terms" hint="Manage the company's payment terms" />
            </Panel>
            <Panel title="Payment advice" description="Tells suppliers which invoices a payment settles.">
              <Checkbox isDisabled={!canManage} isSelected={values.paymentAdviceAuto !== false} onChange={set("paymentAdviceAuto")}>
                Email the payment advice to the supplier when a payment is recorded
              </Checkbox>
            </Panel>
            <Panel title="Bank payment file" description="The file Pay selected makes for the bank's bulk payments.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextField label="Account the bank pays from" isDisabled={!canManage} inputMode="numeric" value={values.bankFileDebitAccount ?? ""}
                  onChange={(value) => setValues((current) => ({ ...current, bankFileDebitAccount: value.replace(/\s+/g, "") }))} />
                <Select label="Layout" isDisabled={!canManage} selectedKey={values.bankFileLayout ?? "csv_header"}
                  onSelectionChange={(key) => setValues((current) => ({ ...current, bankFileLayout: String(key) as "csv_header" | "csv_plain" }))}
                  options={[{ value: "csv_header", label: "CSV with a header line" }, { value: "csv_plain", label: "CSV without a header line" }]} />
              </div>
            </Panel>
            <ExpenseCategories />
          </div>
        </TabPanel>
        <TabPanel id="tds">
          <div className="flex flex-col gap-4 pt-4">
            <Notice tone="info">194C, 194J, 194I, 194H and 194Q come set up with the current rates and limits. 194Q withholds only on purchases above ₹50 lakh in the year; 194C catches up the year&apos;s earlier bills once they cross ₹1 lakh.</Notice>
            <Panel title="TDS on goods (194Q)" description="Only for a buyer whose turnover passed ₹10 crore last year.">
              <Checkbox isDisabled={!canManage} isSelected={Boolean(values.tds194qApplies)} onChange={set("tds194qApplies")}>
                Deduct TDS 194Q on purchases above ₹50 lakh a year from one supplier
              </Checkbox>
            </Panel>
            <WithholdingSections />
          </div>
        </TabPanel>
        <TabPanel id="templates">
          <div className="pt-4">
            <Panel title="Document templates" description="Purchase orders, debit notes and the other Procurement documents print with the company's name, logo, address and registrations.">
              <SettingsLink href="/settings/organization" label="Company profile" hint="Name, logo, address and tax registrations printed on every document" />
            </Panel>
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
}

// Expense categories for direct bills (rent, electricity, internet, ...): each posts to one expense or asset account, with an optional default tax and HSN/SAC.
// Changing a category's account affects future bills only; posted bills keep their journals.
function ExpenseCategories() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "expense-categories");
  const query = useQuery({ queryKey: key, queryFn: listExpenseCategories });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill-options"), queryFn: () => getBillOptions(), staleTime: 60_000 });
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
    <Panel title="Expense categories" description="Used on bills without an order. Each category is recorded in its own account; stock needs an order.">
      {save.error && <Notice>{errorMessage(save.error)}</Notice>}
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
    </Panel>
  );
}

// TDS / withholding sections of the shared tax set-up: the rate withheld from a supplier's bill (on its taxable value), with the law's
// limits (one bill / the year), the rate for individuals and HUFs, and the rate without a PAN (206AA).
function WithholdingSections() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "withholding-sections");
  const query = useQuery({ queryKey: key, queryFn: listWithholdingSections });
  const [draft, setDraft] = useState({ code: "", name: "", rate: "", thresholdSingle: "", thresholdAnnual: "", rateIndividual: "", rateNoPan: "" });
  const save = useMutation({ mutationFn: (input: Record<string, unknown>) => saveWithholdingSection(input),
    onSuccess: () => { setDraft({ code: "", name: "", rate: "", thresholdSingle: "", thresholdAnnual: "", rateIndividual: "", rateNoPan: "" }); void queryClient.invalidateQueries({ queryKey: key }); } });
  return (
    <Panel title="TDS sections" description="Deducted from bills on their taxable value. A supplier has a usual section; a bill may use another.">
      {save.error && <Notice>{errorMessage(save.error)}</Notice>}
      <ul className="flex flex-col divide-y divide-border text-sm">
        {(query.data ?? []).map((section) => (
          <li key={section.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">{section.code}</span> · {section.name} · {Number(section.rate)}%{section.status !== "active" ? " (inactive)" : ""}
              <span className="block text-xs text-text-muted">
                {[section.basis === "excess_over_annual" ? `only on the year's purchases above ₹${Number(section.thresholdAnnual ?? 0).toLocaleString("en-IN")}`
                  : section.thresholdSingle && `from ₹${Number(section.thresholdSingle).toLocaleString("en-IN")} a bill`,
                  section.basis !== "excess_over_annual" && section.thresholdAnnual && `or ₹${Number(section.thresholdAnnual).toLocaleString("en-IN")} a year`,
                  section.rateIndividual && `individuals ${Number(section.rateIndividual)}%`, `no PAN ${section.rateNoPan ? Number(section.rateNoPan) : Math.max(20, Number(section.rate) * 2)}%`].filter(Boolean).join(" · ")}
              </span>
            </span>
            <Button size="compact" variant="ghost" onPress={() => save.mutate({ ...section, status: section.status === "active" ? "inactive" : "active" })}>
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
        <TextField label="Individuals / HUF %" inputMode="decimal" value={draft.rateIndividual} onChange={(value) => setDraft((current) => ({ ...current, rateIndividual: value }))} description="Optional." />
        <TextField label="One bill from (₹)" inputMode="decimal" value={draft.thresholdSingle} onChange={(value) => setDraft((current) => ({ ...current, thresholdSingle: value }))} placeholder="30000" />
        <TextField label="Year from (₹)" inputMode="decimal" value={draft.thresholdAnnual} onChange={(value) => setDraft((current) => ({ ...current, thresholdAnnual: value }))} placeholder="100000" />
        <TextField label="Without PAN %" inputMode="decimal" value={draft.rateNoPan} onChange={(value) => setDraft((current) => ({ ...current, rateNoPan: value }))} description="Empty: 20% or twice the rate." />
        <div className="flex items-end"><Button variant="secondary" isLoading={save.isPending} isDisabled={!draft.code || !draft.name || !draft.rate} onPress={() => save.mutate(draft)}>Add section</Button></div>
      </div>
    </Panel>
  );
}
