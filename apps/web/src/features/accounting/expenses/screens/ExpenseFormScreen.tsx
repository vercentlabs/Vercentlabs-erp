"use client";

// Record (or correct) an expense. The category decides the expense account and suggests the usual GST rate; the amount is entered before
// GST and the GST worked out. Who paid it decides how it posts: the company paid it from a cash or bank account; an employee paid it from
// their own pocket (they are owed it); or it is still owed to the supplier. The receipt or bill is attached here — or, when there is none,
// the reason is given. Save keeps a draft; Submit sends it for approval (or posts it, when the company doesn't require approval).
import { useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Paperclip, X } from "lucide-react";
import { Breadcrumb, Button, Checkbox, ComboBox, ErrorState, PermissionState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useFormChangesWarning } from "@/features/procurement/shared/navigation";
import { useSubmitKey } from "@/shared/http/submit-once";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useQuickCreate } from "@/shell/pickers/useQuickCreate";

import {
  GST_TREATMENTS, PAYMENT_METHODS, cents, createExpense, errorMessage, errorStatus, expenseOptions, expenseStep, fromCents, getExpense, inr, updateExpense, uploadExpenseFile,
  type ExpenseInput, type ExpenseRecord, type GstTreatment,
} from "../api/expenses-api";

type Payer = "company" | "employee" | "owed";
const RATES = ["5", "12", "18", "28", "3", "0.25"];
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const EMPTY = {
  categoryId: "", date: "", description: "", amount: "", partyId: "", payeeName: "", supplierGstin: "", supplierInvoiceReference: "", gstTreatment: "NO_GST" as GstTreatment,
  gstSupply: "INTRA_STATE" as "INTRA_STATE" | "INTER_STATE", gstRate: "18", payer: "company" as Payer, paidFromAccountId: "", paymentMethod: "", claimantUserId: "", departmentId: "",
  costCenterId: "", notes: "", noReceipt: false, noReceiptReason: "",
};

const fromRecord = (record: ExpenseRecord): typeof EMPTY => ({
  categoryId: record.category?.id ?? "", date: record.date, description: record.description, amount: fromCents(cents(record.amount)), partyId: record.partyId ?? "",
  payeeName: record.payeeName ?? "", supplierGstin: record.supplierGstin ?? "", supplierInvoiceReference: record.supplierInvoiceReference ?? "", gstTreatment: record.gstTreatment,
  gstSupply: record.gstSupply ?? "INTRA_STATE", gstRate: record.gstTreatment === "NO_GST" ? "18" : String(record.gstRate), payer: record.claimant ? "employee" : record.settlement === "PAID" ? "company" : "owed",
  paidFromAccountId: record.paidFrom?.id ?? "", paymentMethod: record.paymentMethod ?? "", claimantUserId: record.claimant?.id ?? "", departmentId: record.department?.id ?? "",
  costCenterId: record.costCenter?.id ?? "", notes: record.notes ?? "", noReceipt: Boolean(record.noReceiptReason), noReceiptReason: record.noReceiptReason ?? "",
});

export function ExpenseFormScreen({ id }: { id?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "expense-options"), queryFn: expenseOptions, retry: false });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "expense", id), queryFn: () => getExpense(id!), enabled: Boolean(id), retry: false });
  const [form, setForm] = useState(EMPTY);
  const [loaded, setLoaded] = useState(!id);
  const [files, setFiles] = useState<File[]>([]);
  // A new kind of expense is created in place (Create-Where-You-Are PR7), posting to an expense ledger; the options reload with it.
  const newCategory = useQuickCreate("expenseCategory", {
    onCreated: (record) => { void options.refetch().then(() => setForm((current) => ({ ...current, categoryId: record.id }))); },
  });
  const set = <K extends keyof typeof EMPTY>(key: K) => (value: (typeof EMPTY)[K]) => setForm((current) => ({ ...current, [key]: value }));
  useFormChangesWarning({ form, files: files.length });
  // An expense being corrected fills the form once it arrives (adjusted while rendering, once).
  if (!loaded && existing.data) { setLoaded(true); setForm(fromRecord(existing.data)); }

  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: async (submit: boolean) => submitKey.run(async () => {
      const input = toInput(form, options.data!.today);
      const saved = id ? await updateExpense(id, { ...input, version: existing.data?.version }) : await createExpense(input);
      for (const file of files) await uploadExpenseFile(saved.id, file);
      if (!submit) return { id: saved.id, problem: null as string | null };
      try { await expenseStep(saved.id, "submit"); return { id: saved.id, problem: null }; } catch (error) { return { id: saved.id, problem: errorMessage(error) }; }
    }),
    onSuccess: (result) => router.replace(`/accounting/expenses/${result.id}${result.problem ? `?problem=${encodeURIComponent(result.problem)}` : ""}`),
  });
  const busy = save.isPending || save.isSuccess;

  if (options.isLoading || (id && !loaded && existing.isLoading)) return <LoadingState label="Loading the expense form" rows={8} />;
  if (errorStatus(options.error) === 403 || errorStatus(existing.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  if (!options.data || (id && !existing.data)) return <ErrorState title="Could not load the expense form" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && !["DRAFT", "REJECTED"].includes(existing.data.status))
    return <ErrorState title={`${existing.data.number} can't be edited`} description="Only a draft or an expense sent back is edited. A posted expense is reversed and recorded again." />;
  const data = options.data;
  const category = data.categories.find((entry) => entry.id === form.categoryId);
  const amount = cents(form.amount);
  const gst = form.gstTreatment === "NO_GST" ? 0 : Math.round((amount * Number(form.gstRate || 0)) / 100);
  const total = amount + gst;
  const evidenceCount = files.length + (existing.data?.fileList.length ?? 0);
  const receiptNeeded = category ? category.receiptRequired && total > cents(category.receiptThreshold) : true;
  const gstinBad = form.supplierGstin !== "" && !GSTIN.test(form.supplierGstin.toUpperCase());
  const itcMissing = form.gstTreatment === "GST_CLAIM_ITC" && (!form.supplierGstin || !form.supplierInvoiceReference.trim());
  const ready = Boolean(category && form.description.trim() && amount > 0 && !gstinBad && !itcMissing
    && (form.payer !== "company" || form.paidFromAccountId) && (form.payer !== "employee" || form.claimantUserId) && (!form.noReceipt || form.noReceiptReason.trim().length >= 5));
  const evidenceOk = !receiptNeeded || evidenceCount > 0 || (form.noReceipt && form.noReceiptReason.trim().length >= 5);
  const pickCategory = (key: string) => {
    const next = data.categories.find((entry) => entry.id === key);
    setForm((current) => ({
      ...current, categoryId: key,
      ...(next?.defaultGstRate && current.gstTreatment === "NO_GST" && !id ? { gstTreatment: "GST_NO_ITC" as GstTreatment, gstRate: String(next.defaultGstRate) } : {}),
      ...(next?.defaultGstRate && current.gstTreatment !== "NO_GST" ? { gstRate: String(next.defaultGstRate) } : {}),
    }));
  };
  const pickSupplier = (key: string | null) => {
    const supplier = data.suppliers.find((entry) => entry.id === key);
    setForm((current) => ({ ...current, partyId: key ?? "", payeeName: supplier ? "" : current.payeeName, supplierGstin: supplier?.gstin ?? current.supplierGstin }));
  };
  const costCenters = data.costCenters.filter((entry) => !form.departmentId || !entry.departmentId || entry.departmentId === form.departmentId);
  const title = existing.data ? `Edit ${existing.data.number}` : "Record expense";

  return (
    <DocumentFormPage
      header={{
        breadcrumbs: [<Breadcrumb key="list" href="/accounting/expenses">Expenses</Breadcrumb>,
          ...(existing.data ? [<Breadcrumb key="record" href={`/accounting/expenses/${existing.data.id}`}>{existing.data.number}</Breadcrumb>] : []),
          <Breadcrumb key="this" isCurrent>{existing.data ? "Edit" : "New"}</Breadcrumb>],
        title,
        description: data.approvalRequired ? "Saved as a draft, then submitted for approval by someone else. Approval posts it to the category's account."
          : "Submitting posts it straight away (the company doesn't require approval for expenses).",
      }}
      banner={<>
        {existing.data?.status === "REJECTED" && <Notice tone="warning">Sent back: {existing.data.rejectionReason}</Notice>}
        {Boolean(save.error) && <Notice>{errorMessage(save.error)}</Notice>}
      </>}
      aside={
        <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border bg-surface p-4">
          <span className="text-sm font-semibold text-text">This expense</span>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-text-secondary">Amount</dt><dd className="text-right">{inr(amount / 100, data.baseCurrency)}</dd>
            <dt className="text-text-secondary">GST</dt><dd className="text-right">{inr(gst / 100, data.baseCurrency)}</dd>
            <dt className="font-medium text-text">Total</dt><dd className="text-right font-medium">{inr(total / 100, data.baseCurrency)}</dd>
          </dl>
          <p className="text-xs text-text-secondary">
            {category ? <>Posts to <span className="font-medium text-text">{category.account.label}</span>{form.gstTreatment === "GST_CLAIM_ITC" ? ", GST to input tax credit" : form.gstTreatment === "GST_NO_ITC" ? " (GST included in the cost)" : ""}
              {form.payer === "company" ? ", paid from the account chosen." : form.payer === "employee" ? ", owed to the employee until reimbursed." : ", owed until it is paid."}</> : "Choose a category to see where it posts."}
          </p>
          <div className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${evidenceOk ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
            {!receiptNeeded ? `No receipt needed${category && category.receiptThreshold > 0 ? ` up to ${inr(category.receiptThreshold)}` : ""}` : evidenceOk ? (evidenceCount ? `${evidenceCount} file${evidenceCount === 1 ? "" : "s"} attached` : "No receipt — reason given") : "Attach the receipt to submit"}
          </div>
        </div>
      }
      formActions={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={() => router.replace(existing.data ? `/accounting/expenses/${existing.data.id}` : "/accounting/expenses")}>Cancel</Button>
          <Button variant="secondary" isLoading={save.isPending && save.variables === false} isDisabled={busy || !ready} onPress={() => save.mutate(false)}>Save draft</Button>
          <Button variant="primary" isLoading={save.isPending && save.variables === true} isDisabled={busy || !ready || !evidenceOk} onPress={() => save.mutate(true)}>
            {data.approvalRequired ? "Submit for approval" : "Submit and post"}</Button>
        </>
      }
    >
      <FormSection columns={1} title="Expense">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ComboBox label="Category" isRequired placeholder="What it was for" selectedKey={form.categoryId || null} onSelectionChange={(key) => key && pickCategory(String(key))}
            options={data.categories.map((entry) => ({ value: entry.id, label: entry.name }))} description={category?.description ?? undefined}
            onCreate={newCategory.canCreate ? newCategory.open : undefined} createLabel={(text) => (text ? `+ New category "${text}"` : "+ New category")} />
          {newCategory.drawer}
          <TextField label="Date" type="date" isRequired value={form.date || data.today} onChange={set("date")} description="The date on the bill; its period must be open." />
          <TextField label={`Amount before GST (${data.baseCurrency})`} isRequired inputMode="decimal" placeholder="0.00" value={form.amount} onChange={set("amount")} />
          <div className="sm:col-span-2 lg:col-span-3"><TextField label="Description" isRequired value={form.description} onChange={set("description")} maxLength={500} placeholder="Printer toner for the accounts office" /></div>
        </div>
      </FormSection>

      <FormSection columns={1} title="Payee and GST" description="Who the bill is from. GST can be claimed as input tax credit only with the supplier's GSTIN and the bill number.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ComboBox label="Supplier (if you buy from them)" placeholder="Choose a supplier" selectedKey={form.partyId || null} onSelectionChange={(key) => pickSupplier(key ? String(key) : null)}
            options={data.suppliers.map((entry) => ({ value: entry.id, label: entry.name }))} />
          {!form.partyId && <TextField label="Or the payee's name" value={form.payeeName} onChange={set("payeeName")} maxLength={200} placeholder="Shree Computers" />}
          <TextField label="Bill / invoice number" value={form.supplierInvoiceReference} onChange={set("supplierInvoiceReference")} maxLength={100}
            errorMessage={form.gstTreatment === "GST_CLAIM_ITC" && !form.supplierInvoiceReference.trim() ? "Needed to claim the credit" : undefined} />
          <Select label="GST" selectedKey={form.gstTreatment} onSelectionChange={(key) => set("gstTreatment")(String(key) as GstTreatment)}
            options={GST_TREATMENTS.map(([value, label]) => ({ value, label }))} />
          {form.gstTreatment !== "NO_GST" && <>
            <Select label="GST rate" selectedKey={RATES.includes(form.gstRate) ? form.gstRate : "18"} onSelectionChange={(key) => set("gstRate")(String(key))}
              options={RATES.map((rate) => ({ value: rate, label: `${rate}%` }))} />
            <Select label="Supply" selectedKey={form.gstSupply} onSelectionChange={(key) => set("gstSupply")(key === "INTER_STATE" ? "INTER_STATE" : "INTRA_STATE")}
              options={[{ value: "INTRA_STATE", label: "Within the state (CGST + SGST)" }, { value: "INTER_STATE", label: "From another state (IGST)" }]} />
            <TextField label="Supplier GSTIN" value={form.supplierGstin} onChange={(value) => set("supplierGstin")(value.toUpperCase())} maxLength={15} placeholder="27AAPFU0939F1ZV"
              errorMessage={gstinBad ? "Not a valid GSTIN" : form.gstTreatment === "GST_CLAIM_ITC" && !form.supplierGstin ? "Needed to claim the credit" : undefined} />
          </>}
        </div>
      </FormSection>

      <FormSection columns={1} title="Who paid">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Paid by" selectedKey={form.payer} onSelectionChange={(key) => set("payer")(String(key) as Payer)}
            options={[{ value: "company", label: "The company (cash, bank, card, UPI)" }, { value: "employee", label: "An employee — to reimburse" }, { value: "owed", label: "Not paid yet — owed to the supplier" }]} />
          {form.payer === "company" && <>
            <Select label="Paid from" isRequired placeholder="Cash or bank account" selectedKey={form.paidFromAccountId || null} onSelectionChange={(key) => set("paidFromAccountId")(String(key))}
              options={data.accounts.map((entry) => ({ value: entry.id, label: entry.cash ? `${entry.label} (cash)` : entry.label }))} />
            <Select label="How" selectedKey={form.paymentMethod || (data.accounts.find((entry) => entry.id === form.paidFromAccountId)?.cash ? "cash" : "bank_transfer")}
              onSelectionChange={(key) => set("paymentMethod")(String(key))} options={PAYMENT_METHODS.map(([value, label]) => ({ value, label }))} />
          </>}
          {form.payer === "employee" && <ComboBox label="Employee" isRequired placeholder="Who paid it" selectedKey={form.claimantUserId || null}
            onSelectionChange={(key) => set("claimantUserId")(key ? String(key) : "")} options={data.people.map((entry) => ({ value: entry.id, label: entry.name }))}
            description="They can't approve their own claim. Pay them from the expense once it is approved." />}
          {data.departments.length > 0 && <Select label="Department" selectedKey={form.departmentId || "none"} onSelectionChange={(key) => { set("departmentId")(key === "none" ? "" : String(key)); set("costCenterId")(""); }}
            options={[{ value: "none", label: "None" }, ...data.departments.map((entry) => ({ value: entry.id, label: entry.name }))]} />}
          {costCenters.length > 0 && <Select label="Cost centre" selectedKey={form.costCenterId || "none"} onSelectionChange={(key) => set("costCenterId")(key === "none" ? "" : String(key))}
            options={[{ value: "none", label: "None" }, ...costCenters.map((entry) => ({ value: entry.id, label: entry.name }))]} />}
          <div className="sm:col-span-2 lg:col-span-3"><TextArea label="Notes" value={form.notes} onChange={set("notes")} maxLength={2000} /></div>
        </div>
      </FormSection>

      <FormSection columns={1} title="Receipt or bill" description={receiptNeeded ? "Attach a photo or PDF of the receipt. The approver sees it." : "Not needed for this amount, but it can be attached."}>
        <div className="flex flex-col gap-3">
          {(existing.data?.fileList.length ?? 0) > 0 && <p className="text-sm text-text-secondary">Already attached: {existing.data!.fileList.map((file) => file.fileName).join(", ")}</p>}
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-text">Add files</span>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,.doc,.docx,.xls,.xlsx" aria-label="Receipt files" disabled={busy}
              className="rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1.5 text-sm"
              onChange={(event) => { const chosen = Array.from(event.target.files ?? []); setFiles((current) => [...current, ...chosen].slice(0, 10)); event.target.value = ""; }} />
            <span className="text-xs text-text-muted">Photos, PDF, Word or Excel; up to 10 MB each.</span></label>
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-[var(--radius-control)] border border-border bg-surface-muted px-2 py-1 text-xs">
                  <Paperclip className="size-3" aria-hidden="true" />{file.name}
                  <button type="button" className="ml-1 text-text-muted hover:text-text" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, at) => at !== index))}><X className="size-3" /></button>
                </li>
              ))}
            </ul>
          )}
          {receiptNeeded && <Checkbox isSelected={form.noReceipt} onChange={set("noReceipt")}>There is no receipt</Checkbox>}
          {receiptNeeded && form.noReceipt && <TextField label="Why there is no receipt" isRequired value={form.noReceiptReason} onChange={set("noReceiptReason")} maxLength={500}
            placeholder="The sweet shop gives no bill" description="Your declaration; the approver sees it." />}
        </div>
      </FormSection>
    </DocumentFormPage>
  );
}

function toInput(form: typeof EMPTY, today: string): ExpenseInput {
  const gst = form.gstTreatment !== "NO_GST";
  return {
    categoryId: form.categoryId, date: form.date || today, description: form.description.trim(), amount: fromCents(cents(form.amount)),
    partyId: form.partyId || null, payeeName: form.partyId ? null : form.payeeName.trim() || null, supplierGstin: form.supplierGstin.trim().toUpperCase() || null,
    supplierInvoiceReference: form.supplierInvoiceReference.trim() || null, gstTreatment: form.gstTreatment, gstSupply: gst ? form.gstSupply : null, gstRate: gst ? form.gstRate : null,
    settlement: form.payer === "company" ? "PAID" : "PAYABLE", paidFromAccountId: form.payer === "company" ? form.paidFromAccountId || null : null,
    paymentMethod: form.payer === "company" ? form.paymentMethod || null : null, claimantUserId: form.payer === "employee" ? form.claimantUserId || null : null,
    departmentId: form.departmentId || null, costCenterId: form.costCenterId || null, notes: form.notes.trim() || null,
    noReceiptReason: form.noReceipt ? form.noReceiptReason.trim() || null : null,
  };
}
