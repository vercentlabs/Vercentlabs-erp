"use client";

// Projects — Project Expenses on screen. One expense record wherever it is opened — My Expenses, the project, an approval queue, Finance.
// Approval, Finance verification, reimbursement and customer recharge show as separate states; the project's figures (claims, recognized
// cost, commitments, reimbursements, recharge) are separate stages of the same spending and are never added into one total.
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button, Checkbox, Dialog, EmptyState, ErrorState, LinkButton, PageHeader, PermissionState, RadioGroup, Radio, Select, StatusBadge, Tab, TabList, Tabs, TextArea, TextField,
} from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { PROJECTS_BASE, dateLabel, errorCode, errorDetails, errorMessage, errorStatus, newKey } from "../api/projects-api";
import {
  EXPENSES_BASE, STATUS_TONE, createExpense, decideCorrection, expenseAction, expensesExportHref, getExpense, getExpenseOptions, getExpenseSettings, getExpenseSummary, listExpenses, listReceipts,
  moneyLabel, projectExpenseAction, receiptHref, removeReceipt, saveExpenseSettings, searchBillLines, updateExpense, uploadReceipt, type Expense, type ExpenseDetail,
} from "./expenses-api";

const today = () => new Date().toISOString().slice(0, 10);
const useRefresh = () => {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
};
function States({ expense }: { expense: Expense }) {
  return (
    <span className="flex flex-wrap gap-1">
      <StatusBadge tone={STATUS_TONE[expense.status] ?? "neutral"}>{expense.statusLabel}</StatusBadge>
      {expense.status === "APPROVED" && <StatusBadge tone={expense.financeStatus === "VERIFIED" ? "success" : "info"}>{expense.financeStatus === "VERIFIED" ? "Cost recognized" : "Finance review"}</StatusBadge>}
      {expense.reimbursable && !["NOT_REQUESTED", "NOT_APPLICABLE"].includes(expense.reimbursementStatus) && <StatusBadge tone={expense.reimbursementStatus === "PAID" ? "success" : expense.reimbursementStatus === "ADJUSTMENT_REQUIRED" ? "danger" : "warning"}>{expense.reimbursementLabel}</StatusBadge>}
      {expense.billingStatus && ["ELIGIBLE_UNBILLED", "RESERVED_FOR_BILLING", "INVOICED", "ADJUSTMENT_REQUIRED"].includes(expense.billingStatus) && <StatusBadge tone={expense.billingStatus === "ADJUSTMENT_REQUIRED" ? "danger" : "info"}>{expense.billingLabel ?? ""}</StatusBadge>}
      {expense.missingReceipt && <StatusBadge tone="warning">No receipt</StatusBadge>}
    </span>
  );
}

// ------------------------------------------------------------------ the claim form
type FormValues = { projectId: string; taskId: string; claimantUserId: string; expenseDate: string; categoryId: string; description: string; amount: string; currency: string; exchangeRate: string;
  paymentSource: string; paymentReference: string; supplierInvoiceNumber: string; supplierInvoiceDate: string; supplierGstin: string; taxableAmount: string; cgstAmount: string; sgstAmount: string; igstAmount: string };
export function ExpenseFormDialog({ projectId, expense, onClose, onDone }: { projectId?: string; expense?: ExpenseDetail; onClose: () => void; onDone: (id: string, text: string) => void }) {
  const workspace = useWorkspaceContext();
  const [values, setValues] = useState<FormValues>({
    projectId: expense?.projectId ?? projectId ?? "", taskId: expense?.taskId ?? "", claimantUserId: expense?.claimantId ?? "", expenseDate: expense?.expenseDate ?? today(), categoryId: expense?.categoryId ?? "",
    description: expense?.description ?? "", amount: expense?.amount ?? "", currency: expense?.currency ?? "", exchangeRate: expense?.exchangeRate ?? "", paymentSource: expense?.paymentSource ?? "EMPLOYEE",
    paymentReference: expense?.paymentReference ?? "", supplierInvoiceNumber: expense?.supplierInvoice.number ?? "", supplierInvoiceDate: expense?.supplierInvoice.date ?? "", supplierGstin: expense?.supplierInvoice.gstin ?? "",
    taxableAmount: expense?.supplierInvoice.taxable ?? "", cgstAmount: expense?.supplierInvoice.cgst ?? "", sgstAmount: expense?.supplierInvoice.sgst ?? "", igstAmount: expense?.supplierInvoice.igst ?? "",
  });
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [taxOpen, setTaxOpen] = useState(Boolean(expense?.supplierInvoice.number || expense?.supplierInvoice.taxable));
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "expense-options", values.projectId || "none"), queryFn: () => getExpenseOptions(values.projectId || undefined) });
  const set = (name: keyof FormValues) => (next: string) => setValues((current) => ({ ...current, [name]: next }));
  const o = options.data;
  const currency = values.currency || o?.currency || "INR";
  const category = o?.categories.find((row) => row.id === values.categoryId);
  const save = async () => {
    setBusy(true); setError(null); setField(null);
    const body: Record<string, unknown> = { ...values, taskId: values.taskId || null, claimantUserId: values.claimantUserId || undefined, currency, exchangeRate: currency === o?.currency ? undefined : values.exchangeRate,
      supplierInvoiceDate: values.supplierInvoiceDate || null, taxableAmount: values.taxableAmount || null, cgstAmount: values.cgstAmount || null, sgstAmount: values.sgstAmount || null, igstAmount: values.igstAmount || null };
    try {
      if (expense) { await updateExpense(expense.id, { ...body, expectedVersion: expense.version }); onDone(expense.id, "Expense updated."); }
      else { const made = await createExpense({ ...body, idempotencyKey: key }); onDone(made.expenseId, `${made.code} saved as a draft — add the receipt, then submit it.`); }
    } catch (failure) { setError(errorMessage(failure)); setField(String((errorDetails(failure) as { field?: string }).field ?? "")); } finally { setBusy(false); }
  };
  const err = (name: string) => (field === name ? error ?? undefined : undefined);
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={expense ? `Edit ${expense.code}` : "New project expense"} size="lg"
      description="Record what was spent for the project. Approval, Finance verification and any reimbursement follow; nothing is paid or invoiced from here.">
      {options.isLoading ? <LoadingState label="Loading" rows={3} /> : !o ? <Notice tone="danger">{errorMessage(options.error)}</Notice> : (
        <div className="flex flex-col gap-3">
          {error && !field && <Notice tone="danger">{error}</Notice>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Project" isRequired selectedKey={values.projectId || null} isDisabled={Boolean(projectId || expense)} onSelectionChange={(next) => setValues((current) => ({ ...current, projectId: String(next ?? ""), taskId: "" }))}
              options={o.projects.map((row) => ({ value: row.id, label: row.label }))} errorMessage={err("projectId")} />
            <Select label="Task (optional)" selectedKey={values.taskId || null} isDisabled={!values.projectId} onSelectionChange={(next) => set("taskId")(String(next ?? ""))}
              options={[{ value: "", label: "No task" }, ...(o.tasks ?? []).map((row) => ({ value: row.id, label: row.label }))]} errorMessage={err("taskId")} />
            {(o.claimants?.length ?? 0) > 0 && !expense && (
              <Select label="Claimant" selectedKey={values.claimantUserId || null} onSelectionChange={(next) => set("claimantUserId")(String(next ?? ""))} description="Leave empty for your own claim."
                options={[{ value: "", label: "Me" }, ...(o.claimants ?? []).map((row) => ({ value: row.id, label: row.name }))]} errorMessage={err("claimantUserId")} />
            )}
            <TextField label="Date spent" type="date" isRequired value={values.expenseDate} onChange={set("expenseDate")} errorMessage={err("expenseDate")} />
            <Select label="Category" isRequired selectedKey={values.categoryId || null} onSelectionChange={(next) => set("categoryId")(String(next ?? ""))}
              options={o.categories.map((row) => ({ value: row.id, label: row.name }))} description={category?.description ?? "A reporting category — Finance decides the accounting."} errorMessage={err("categoryId")} />
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
              <TextField label={`Amount (${currency})`} isRequired inputMode="decimal" value={values.amount} onChange={set("amount")} errorMessage={err("amount")} />
              <TextField label="Currency" value={currency} onChange={(next) => set("currency")(next.toUpperCase().slice(0, 3))} errorMessage={err("currency")} />
            </div>
            {currency !== o.currency && <TextField label={`Rate to ${o.currency}`} inputMode="decimal" value={values.exchangeRate} onChange={set("exchangeRate")} errorMessage={err("exchangeRate")} />}
          </div>
          <TextArea label="Business purpose" isRequired value={values.description} onChange={set("description")} maxLength={2000} errorMessage={err("description")}
            description={category?.descriptionRequired ? "Say what was bought and why." : "For example: customer-site visit for the ERP implementation."} />
          <RadioGroup label="Who paid?" value={values.paymentSource} onChange={set("paymentSource")} orientation="horizontal">
            {o.sources.filter((row) => row.value !== "SUPPLIER" || o.can.finance || values.paymentSource === "SUPPLIER").map((row) => <Radio key={row.value} value={row.value}>{row.label}</Radio>)}
          </RadioGroup>
          {values.paymentSource === "EMPLOYEE" && <p className="text-xs text-text-muted">This may be reimbursed after approval and Finance verification.</p>}
          {values.paymentSource === "COMPANY" && <TextField label="Card or bank reference" value={values.paymentReference} onChange={set("paymentReference")} errorMessage={err("paymentReference")}
            description="Finance matches it to the company payment. No reimbursement is made." />}
          <button type="button" className="self-start text-sm text-brand underline" onClick={() => setTaxOpen(!taxOpen)}>{taxOpen ? "Hide tax invoice details" : "Add tax invoice details (GST)"}</button>
          {taxOpen && (
            <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
              <TextField label="Invoice number" value={values.supplierInvoiceNumber} onChange={set("supplierInvoiceNumber")} />
              <TextField label="Invoice date" type="date" value={values.supplierInvoiceDate} onChange={set("supplierInvoiceDate")} />
              <TextField label="Supplier GSTIN" value={values.supplierGstin} onChange={set("supplierGstin")} />
              <TextField label="Taxable value" inputMode="decimal" value={values.taxableAmount} onChange={set("taxableAmount")} errorMessage={err("taxableAmount")} />
              <TextField label="CGST" inputMode="decimal" value={values.cgstAmount} onChange={set("cgstAmount")} />
              <TextField label="SGST" inputMode="decimal" value={values.sgstAmount} onChange={set("sgstAmount")} />
              <TextField label="IGST" inputMode="decimal" value={values.igstAmount} onChange={set("igstAmount")} />
              <p className="text-xs text-text-muted sm:col-span-3">Finance decides whether the GST is recoverable; recoverable GST is not project cost.</p>
            </div>
          )}
          {field && error && <Notice tone="danger">{error}</Notice>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} isDisabled={busy} onPress={save}>{expense ? "Save" : "Save draft"}</Button></div>
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ the queues
const VIEWS = [{ id: "mine", label: "My expenses" }, { id: "approvals", label: "Pending approval" }, { id: "team", label: "Team expenses" }, { id: "finance", label: "Finance review" },
  { id: "reimbursements", label: "Reimbursements" }, { id: "corrections", label: "Corrections" }, { id: "billing", label: "Recharge" }];
export function ExpensesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "mine";
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const filters = { view, search: search.trim() || undefined, page, pageSize: 50 };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "expenses", filters), queryFn: () => listExpenses(filters), retry: false });
  const forbidden = list.isError && errorStatus(list.error) === 403;
  const go = (next: string) => { setPage(1); router.replace(`${pathname}?view=${next}`, { scroll: false }); };
  const data = list.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Project Expenses" description="Claims and costs of your projects. Approval, Finance verification, reimbursement and customer recharge are separate steps."
        primaryAction={<Button variant="primary" onPress={() => setDialog(true)}>New expense</Button>}
        secondaryActions={data?.can.export ? <LinkButton variant="secondary" href={expensesExportHref({ view })}>Export</LinkButton> : undefined} />
      <Tabs selectedKey={view} onSelectionChange={(key) => go(String(key))}>
        <TabList aria-label="Expense views">{VIEWS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      <div className="sm:max-w-sm"><TextField label="Search" value={search} onChange={(next) => { setSearch(next); setPage(1); }} placeholder="Description, project or EXP number" /></div>
      {forbidden ? <PermissionState title="This view is not available to you" description="It needs a team, approval or Finance permission." />
        : list.isLoading ? <LoadingState label="Loading expenses" rows={6} />
        : list.isError || !data ? <ErrorState title="Could not load expenses" description={errorMessage(list.error)} />
        : data.items.length === 0 ? <EmptyState title="Nothing here" description={view === "mine" ? "Your project expense claims appear here." : "Nothing waits in this queue."} />
        : (
          <Panel>
            <p className="text-xs text-text-muted">{`${data.total} expense${data.total === 1 ? "" : "s"} · ${moneyLabel(data.totalAmount, data.currency)} claimed`}</p>
            <ExpenseTable rows={data.items} />
            {data.pages > 1 && (
              <div className="flex items-center justify-between pt-2 text-sm text-text-muted"><span>{`Page ${data.page} of ${data.pages}`}</span>
                <span className="flex gap-2"><Button size="compact" variant="secondary" isDisabled={page <= 1} onPress={() => setPage(page - 1)}>Previous</Button>
                  <Button size="compact" variant="secondary" isDisabled={page >= data.pages} onPress={() => setPage(page + 1)}>Next</Button></span></div>
            )}
          </Panel>
        )}
      {dialog && <ExpenseFormDialog onClose={() => setDialog(false)} onDone={(id) => router.push(`${EXPENSES_BASE}/${id}`)} />}
    </div>
  );
}
function ExpenseTable({ rows, project = false }: { rows: Expense[]; project?: boolean }) {
  return (
    <>
      <ul className="flex flex-col divide-y divide-border md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`${EXPENSES_BASE}/${row.id}`} className="flex flex-col gap-1 py-3 focus-visible:outline-2 focus-visible:outline-focus">
              <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className="block truncate font-medium">{row.description}</span>
                <span className="block text-xs text-text-muted">{`${row.code} · ${dateLabel(row.expenseDate)} · ${row.category}${project ? ` · ${row.claimant}` : ` · ${row.projectCode}`}`}</span></span>
                <span className="shrink-0 font-semibold tabular-nums">{moneyLabel(row.amount, row.currency)}</span></span>
              <States expense={row} />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <LinesTable columns={["Expense", "Date", project ? "Claimant" : "Project", "Category", { label: "Amount", numeric: true }, "Paid by", "State"]}>
          {rows.map((row) => (
            <tr key={row.id}>
              <Cell><Link className="font-medium text-brand hover:underline" href={`${EXPENSES_BASE}/${row.id}`}>{row.code}</Link><span className="block max-w-72 truncate text-xs text-text-muted">{row.description}</span></Cell>
              <Cell>{dateLabel(row.expenseDate)}</Cell><Cell>{project ? row.claimant : row.projectCode}</Cell><Cell>{row.category}</Cell>
              <Cell numeric>{moneyLabel(row.amount, row.currency)}</Cell><Cell>{row.paymentSourceLabel}</Cell><Cell><States expense={row} /></Cell>
            </tr>
          ))}
        </LinesTable>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ one expense
export function ExpenseDetailScreen({ expenseId }: { expenseId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const refresh = useRefresh();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "expense", expenseId), queryFn: () => getExpense(expenseId), retry: false });
  const files = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "expense-files", expenseId), queryFn: () => listReceipts(expenseId), enabled: query.isSuccess });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [dialog, setDialog] = useState<"edit" | "finance" | "billing" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (query.isLoading) return <LoadingState label="Loading the expense" rows={6} />;
  if (query.isError || !query.data) return <ErrorState title="Expense not found" description={errorStatus(query.error) === 404 ? "It does not exist, or it is not yours to see." : errorMessage(query.error)}
    action={{ label: "My expenses", onPress: () => router.push(EXPENSES_BASE) }} />;
  const e = query.data;
  const done = async (text: string, tone: "success" | "warning" = "success") => { await refresh(); setMessage({ tone, text }); };
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true); setMessage(null);
    try { await work(); await done(text); }
    catch (failure) {
      if (errorCode(failure) === "PROJECT_EXPENSE_DUPLICATE_SUSPECTED") {
        const dupes = ((errorDetails(failure) as { duplicates?: Array<{ code: string; reason: string }> }).duplicates ?? []).map((row) => `${row.code} (${row.reason.toLowerCase()})`).join(", ");
        setAsk({ title: "A similar expense exists", description: `Review ${dupes} before submitting. Submitting keeps both claims — nothing is merged.`, fields: [], confirm: "Submit anyway",
          run: async (_v, key) => { await expenseAction(e.id, "submit", { expectedVersion: e.version, duplicateReviewed: true, idempotencyKey: key }); await done("Submitted for approval."); } });
      } else setMessage({ tone: "danger", text: errorMessage(failure) });
    } finally { setBusy(false); }
  };
  const submit = () => {
    if (e.receiptRequired && !(files.data ?? []).length) {
      setAsk({ title: "Submit without a receipt?", description: "A receipt is required. Explain why there is none — the approver must accept the exception.",
        fields: [{ name: "reason", label: "Why there is no receipt", kind: "textarea", required: true }], confirm: "Submit",
        run: async (v, key) => { await expenseAction(e.id, "submit", { expectedVersion: e.version, receiptExceptionReason: String(v.reason), idempotencyKey: key }).catch(async (failure) => {
          if (errorCode(failure) !== "PROJECT_EXPENSE_DUPLICATE_SUSPECTED") throw failure;
          await expenseAction(e.id, "submit", { expectedVersion: e.version, receiptExceptionReason: String(v.reason), duplicateReviewed: true, idempotencyKey: newKey() });
        }); await done("Submitted for approval."); } });
      return;
    }
    void run(() => expenseAction(e.id, "submit", { expectedVersion: e.version, idempotencyKey: newKey() }), "Submitted for approval.");
  };
  const reason = (title: string, action: string, confirm: string, tone: "primary" | "danger" = "primary", label = "Reason") => setAsk({ title, fields: [{ name: "reason", label, kind: "textarea", required: true }], confirm, tone,
    run: async (v, key) => { await expenseAction(e.id, action, { reason: String(v.reason), expectedVersion: e.version, idempotencyKey: key }); await done(`${confirm} — done.`); } });
  const approve = () => setAsk({ title: `Approve ${e.code}?`, description: e.missingReceipt ? `No receipt: "${e.receiptException ?? ""}". Approving accepts this exception.` : "The claim's business purpose is approved. Finance verifies documents and tax next.",
    fields: [{ name: "note", label: "Note (optional)", kind: "textarea" }], confirm: "Approve",
    run: async (v, key) => { await expenseAction(e.id, "approve", { expectedVersion: e.version, acceptMissingReceipt: e.missingReceipt, note: String(v.note ?? ""), idempotencyKey: key }); await done("Approved."); } });
  const reimburse = () => setAsk({ title: "Record a reimbursement payment", description: `Outstanding: ${moneyLabel(e.reimbursement?.outstanding ?? null, e.baseCurrency)}. The payment settles the claim — it is not another cost.`,
    fields: [{ name: "amount", label: "Amount paid", kind: "quantity", required: true, initial: e.reimbursement?.outstanding ?? "" }, { name: "paidOn", label: "Paid on", kind: "date", required: true, initial: today() },
      { name: "reference", label: "Payment reference", kind: "text", required: true }], confirm: "Record payment",
    run: async (v, key) => { await expenseAction(e.id, "reimburse", { amount: String(v.amount), paidOn: String(v.paidOn), reference: String(v.reference), commandId: key }); await done("Payment recorded."); } });
  const correction = () => setAsk({ title: `Request a correction of ${e.code}`, description: "Approved expenses change only through a correction: its cost, reimbursement and recharge are reviewed by their owners.",
    fields: [{ name: "kind", label: "What is wrong", kind: "select", required: true, options: [{ value: "AMOUNT", label: "Incorrect amount" }, { value: "REFUND", label: "Partly refunded" },
      { value: "CATEGORY", label: "Wrong category" }, { value: "DUPLICATE", label: "Duplicate claim" }, { value: "OTHER", label: "Something else" }] },
    { name: "amount", label: "Corrected amount (if it changes)", kind: "quantity" }, { name: "reason", label: "Explanation", kind: "textarea", required: true }], confirm: "Request correction",
    run: async (v, key) => { await expenseAction(e.id, "correction", { kind: String(v.kind), reason: String(v.reason), changes: String(v.amount ?? "").trim() ? { amount: String(v.amount) } : {}, idempotencyKey: key }); await done("Correction requested."); } });
  const upload = (file: File) => void run(() => uploadReceipt(e.id, file), `${file.name} attached.`);
  const actions: ReactNode[] = [];
  if (e.can.edit) actions.push(<Button key="edit" variant="secondary" onPress={() => setDialog("edit")}>Edit</Button>);
  if (e.can.submit) actions.push(<Button key="submit" variant="primary" isLoading={busy} onPress={submit}>{e.status === "CHANGES_REQUESTED" ? "Resubmit" : "Submit"}</Button>);
  if (e.can.approve) actions.push(<Button key="approve" variant="primary" onPress={approve}>Approve</Button>, <Button key="return" variant="secondary" onPress={() => reason("Return for changes", "request-changes", "Return", "primary", "What needs to change")}>Return</Button>,
    <Button key="reject" variant="danger" onPress={() => reason("Reject this expense", "reject", "Reject", "danger")}>Reject</Button>);
  if (e.can.finance) actions.push(<Button key="finance" variant="primary" onPress={() => setDialog("finance")}>Finance review</Button>);
  if (e.can.reimburse) actions.push(<Button key="pay" variant="secondary" onPress={reimburse}>Record payment</Button>);
  if (e.can.billing && e.billingClassification !== undefined && !["REJECTED", "WITHDRAWN"].includes(e.status) && e.billingStatus !== "INVOICED") actions.push(<Button key="billing" variant="secondary" onPress={() => setDialog("billing")}>Customer billing</Button>);
  if (e.can.correct) actions.push(<Button key="correct" variant="secondary" onPress={correction}>Request correction</Button>);
  if (e.can.withdraw) actions.push(<Button key="withdraw" variant="ghost" onPress={() => reason("Withdraw this claim", "withdraw", "Withdraw", "danger")}>Withdraw</Button>);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${e.code} · ${moneyLabel(e.amount, e.currency)}`} description={e.description} secondaryActions={<span className="flex flex-wrap gap-2">{actions}</span>} />
      <States expense={e} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {e.duplicates.length > 0 && <Notice tone="warning">{`Possible duplicate: ${e.duplicates.map((row) => `${row.code} (${moneyLabel(row.amount, row.currency)} on ${dateLabel(row.expenseDate)}, ${row.reason.toLowerCase()})`).join("; ")}. Review before deciding — claims are never merged.`}</Notice>}
      {e.overLimit && e.status === "SUBMITTED" && <Notice tone="info">Above the company&apos;s approval limit for project managers: the business owner approves it.</Notice>}
      {e.status === "CHANGES_REQUESTED" && <Notice tone="warning">{`Returned: ${[...e.history].reverse().find((row) => row.to === "CHANGES_REQUESTED")?.reason ?? ""}`}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Details">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            {([["Project", <Link key="p" className="text-brand hover:underline" href={`${PROJECTS_BASE}/${e.projectId}?tab=time`}>{e.project}</Link>], ["Task", e.task ?? "—"], ["Claimant", `${e.claimant}${e.enteredBy ? ` (entered by ${e.enteredBy})` : ""}`],
              ["Date spent", dateLabel(e.expenseDate)], ["Category", e.category], ["Paid by", e.paymentSourceLabel], ["Amount", moneyLabel(e.amount, e.currency)],
              ...(e.currency !== e.baseCurrency ? [["In company currency", `${moneyLabel(e.baseAmount, e.baseCurrency)} at ${e.exchangeRate}`] as [string, ReactNode]] : []),
              ...(e.paymentReference ? [["Payment reference", e.paymentReference] as [string, ReactNode]] : []), ["Approved", e.approvedAt ? `${formatDateTime(e.approvedAt)}${e.approvedBy ? ` by ${e.approvedBy}` : ""}` : "—"],
              ...(e.supplierInvoice.number || e.supplierInvoice.taxable ? [["Tax invoice", `${e.supplierInvoice.number ?? ""} ${e.supplierInvoice.gstin ? `· GSTIN ${e.supplierInvoice.gstin}` : ""} ${e.supplierInvoice.taxable ? `· taxable ${moneyLabel(e.supplierInvoice.taxable, e.baseCurrency)}` : ""}`.trim()] as [string, ReactNode]] : []),
            ] as Array<[string, ReactNode]>).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-text-muted">{label}</dt><dd className="break-words">{value}</dd></div>)}
          </dl>
        </Panel>
        <Panel title="Receipts" actions={e.can.receipts ? <>
          <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload(file); }} />
          <Button size="compact" variant="secondary" isDisabled={busy} onPress={() => input.current?.click()}>Attach</Button></> : undefined}>
          {(files.data ?? []).length === 0 ? <p className="text-sm text-text-muted">{e.receiptException ? `No receipt — exception: "${e.receiptException}"${e.receiptExceptionAcceptedBy ? `, accepted by ${e.receiptExceptionAcceptedBy}` : ""}.` : e.receiptRequired ? "A receipt is required before submitting (or explain the exception)." : "No receipt attached."}</p> : (
            <ul className="flex flex-col gap-1 text-sm">{(files.data ?? []).map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-2"><a className="truncate text-brand hover:underline" href={receiptHref(e.id, file.id)}>{file.fileName}</a>
                {e.can.edit && <Button size="compact" variant="ghost" onPress={() => run(() => removeReceipt(e.id, file.id), "Receipt removed.")}>Remove</Button>}</li>
            ))}</ul>
          )}
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Finance">
          {e.taxTreatment === undefined ? <p className="text-sm text-text-muted">Finance figures are shown to Finance and the project&apos;s managers.</p> : (
            <dl className="flex flex-col gap-2 text-sm">
              <div><dt className="text-xs text-text-muted">Review</dt><dd>{e.financeStatus === "VERIFIED" ? `Verified${e.financeReviewedBy ? ` by ${e.financeReviewedBy}` : ""}` : e.financeStatus === "RETURNED" ? "Returned to the claimant" : e.status === "APPROVED" ? "Waiting for Finance" : "After approval"}</dd></div>
              <div><dt className="text-xs text-text-muted">GST</dt><dd>{e.taxLabel}</dd></div>
              <div><dt className="text-xs text-text-muted">Recognized project cost</dt><dd className="font-semibold">{e.costBasis ? `${moneyLabel(e.costBasis, e.baseCurrency)} on ${dateLabel(e.recognitionDate ?? null)}` : "Not yet"}</dd></div>
              {e.financeNote && <div><dt className="text-xs text-text-muted">Note</dt><dd>{e.financeNote}</dd></div>}
            </dl>
          )}
        </Panel>
        <Panel title="Reimbursement">
          {!e.reimbursable ? <p className="text-sm text-text-muted">{e.paymentSource === "COMPANY" ? "Company-paid: nothing is owed to the employee." : "Supplier-billed: Finance pays the supplier bill."}</p>
            : !e.reimbursement ? <p className="text-sm text-text-muted">Requested from Finance once the claim is approved and verified.</p> : (
              <>
                <p className="text-sm">{`${moneyLabel(e.reimbursement.paid, e.baseCurrency)} paid of ${moneyLabel(e.reimbursement.amount, e.baseCurrency)}`}</p>
                <ul className="flex flex-col gap-1 text-xs text-text-muted">{e.reimbursement.payments.map((p) => <li key={p.at}>{`${moneyLabel(p.amount, e.baseCurrency)} on ${dateLabel(p.paidOn)} · ${p.reference}`}</li>)}</ul>
              </>
            )}
        </Panel>
        <Panel title="Customer billing">
          {e.billingClassification === undefined ? <p className="text-sm text-text-muted">Shown to those who see customer recharges.</p> : (
            <dl className="flex flex-col gap-2 text-sm">
              <div><dt className="text-xs text-text-muted">Classification</dt><dd>{e.classificationLabel}</dd></div>
              <div><dt className="text-xs text-text-muted">State</dt><dd>{e.billingLabel}</dd></div>
              {e.rechargeAmount && <div><dt className="text-xs text-text-muted">Recharge</dt><dd>{`${moneyLabel(e.rechargeAmount, e.baseCurrency)} of ${moneyLabel(e.baseAmount, e.baseCurrency)} — the internal cost stays whole`}</dd></div>}
              {e.recharge.map((r) => <div key={r.requestId} className="text-xs text-text-muted">{`${r.number}: ${r.status.toLowerCase()} (${r.requestStatus.toLowerCase()})`}</div>)}
            </dl>
          )}
        </Panel>
      </div>
      {e.corrections.length > 0 && (
        <Panel title="Corrections">
          <ul className="flex flex-col gap-3">{e.corrections.map((x) => (
            <li key={x.id} className="flex flex-col gap-1 text-sm">
              <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{`${x.number} · ${x.kind.toLowerCase()}`}</span><StatusBadge tone={x.status === "APPLIED" ? "success" : x.status === "REJECTED" ? "neutral" : "warning"}>{x.status.toLowerCase()}</StatusBadge></span>
              <span>{x.reason}</span>
              <span className="text-xs text-text-muted">{`Requested by ${x.requestedBy ?? "—"} ${formatDateTime(x.requestedAt)}${x.decidedBy ? ` · decided by ${x.decidedBy}` : ""}${Array.isArray((x.impact as { flags?: string[] }).flags) && (x.impact as { flags: string[] }).flags.length ? ` · follow-up: ${(x.impact as { flags: string[] }).flags.join(", ").toLowerCase().replace(/_/g, " ")}` : ""}`}</span>
              {x.canDecide && <span className="flex gap-2"><Button size="compact" variant="primary" onPress={() => setAsk({ title: "Apply the correction?", description: "The recognized cost is reversed and recognized again; a paid reimbursement or an invoiced recharge that no longer fits is flagged for Finance or Sales.",
                fields: [{ name: "note", label: "Note", kind: "textarea" }], confirm: "Apply", run: async (v) => { await decideCorrection(x.id, { decision: "APPLY", note: String(v.note ?? "") }); await done("Correction applied."); } })}>Apply</Button>
                <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Reject the correction?", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }], confirm: "Reject", tone: "danger",
                  run: async (v) => { await decideCorrection(x.id, { decision: "REJECT", note: String(v.note) }); await done("Correction rejected."); } })}>Reject</Button></span>}
            </li>
          ))}</ul>
        </Panel>
      )}
      <Panel title="History">
        <ol className="flex flex-col divide-y divide-border">{[...e.history].reverse().map((row) => (
          <li key={row.id} className="flex flex-wrap justify-between gap-x-4 py-2 text-sm"><span><span className="font-medium">{row.action.toLowerCase().replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase())}</span>{row.reason && <span className="text-text-secondary"> — {row.reason}</span>}</span>
            <span className="text-xs text-text-muted">{`${formatDateTime(row.at)} · ${row.actor}`}</span></li>
        ))}</ol>
      </Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "edit" && <ExpenseFormDialog expense={e} onClose={() => setDialog(null)} onDone={async (_id, text) => { setDialog(null); await done(text); }} />}
      {dialog === "finance" && <FinanceDialog expense={e} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); await done(text); }} />}
      {dialog === "billing" && <BillingDialog expense={e} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); await done(text); }} />}
    </div>
  );
}
function FinanceDialog({ expense: e, onClose, onDone }: { expense: ExpenseDetail; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [tax, setTax] = useState(e.supplierInvoice.taxable ? "RECOVERABLE" : "NO_TAX");
  const [basis, setBasis] = useState("");
  const [note, setNote] = useState("");
  const [line, setLine] = useState(e.vendorBillLineId ?? "");
  const [search, setSearch] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = useQuery({ queryKey: ["expense-bill-lines", search], queryFn: () => searchBillLines(search), enabled: e.paymentSource === "SUPPLIER" });
  const act = async (decision: "VERIFY" | "RETURN") => {
    setBusy(true); setError(null);
    try {
      await expenseAction(e.id, "finance-review", { decision, taxTreatment: tax, costBasis: basis || undefined, note: note || undefined, vendorBillLineId: line || undefined, expectedVersion: e.version, idempotencyKey: key });
      await onDone(decision === "VERIFY" ? "Verified: the cost is recognized." : "Returned to the claimant.");
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={`Finance review · ${e.code}`} size="lg"
      description="Verify the documents and the tax treatment. The cost is recognized once, against its source; recoverable GST and TDS never change the project cost.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Select label="GST treatment" selectedKey={tax} onSelectionChange={(next) => setTax(String(next))} options={[{ value: "NO_TAX", label: "No GST" }, { value: "RECOVERABLE", label: "GST recoverable — the taxable value is the cost" },
          { value: "NON_RECOVERABLE", label: "GST not recoverable — part of the cost" }]} />
        <TextField label="Cost basis (optional)" inputMode="decimal" value={basis} onChange={setBasis} description={`Default: ${tax === "RECOVERABLE" ? `the taxable value ${moneyLabel(e.supplierInvoice.taxable, e.baseCurrency)}` : moneyLabel(e.baseAmount, e.baseCurrency)}.`} />
        {e.paymentSource === "SUPPLIER" && (
          <div className="flex flex-col gap-2">
            <TextField label="Find the supplier bill line" value={search} onChange={setSearch} placeholder="Bill number or supplier invoice" />
            <Select label="Supplier bill line" selectedKey={line || null} onSelectionChange={(next) => setLine(String(next ?? ""))}
              options={(lines.data ?? []).map((row) => ({ value: row.id, label: `${row.label} · ${moneyLabel(row.remaining, e.baseCurrency)} left` }))} />
          </div>
        )}
        <TextArea label="Note" value={note} onChange={setNote} maxLength={1000} description="Required when returning the claim." />
        <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="secondary" isDisabled={busy || note.trim().length < 3} onPress={() => act("RETURN")}>Return to claimant</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy} onPress={() => act("VERIFY")}>Verify and recognize</Button></div>
      </div>
    </Dialog>
  );
}
function BillingDialog({ expense: e, onClose, onDone }: { expense: ExpenseDetail; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "expense-options", e.projectId), queryFn: () => getExpenseOptions(e.projectId) });
  const [classification, setClassification] = useState(e.billingClassification ?? "NON_BILLABLE");
  const [amount, setAmount] = useState(e.rechargeAmount ?? "");
  const [line, setLine] = useState(e.rechargeSalesOrderLineId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await expenseAction(e.id, "billing", { classification, rechargeAmount: classification === "RECHARGE_ELIGIBLE" ? amount || undefined : undefined, salesOrderLineId: line || undefined, expectedVersion: e.version }); await onDone("Billing decided."); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Customer billing" description="Whether the customer is charged separately. It never changes the internal project cost.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Select label="Classification" selectedKey={classification} onSelectionChange={(next) => setClassification(String(next))} options={[{ value: "NON_BILLABLE", label: "Not billable" },
          { value: "INCLUDED_IN_FIXED_FEE", label: "Included in the fixed fee" }, { value: "RECHARGE_ELIGIBLE", label: "Rechargeable to the customer" }, { value: "ELIGIBILITY_PENDING", label: "To be decided" }]} />
        {classification === "RECHARGE_ELIGIBLE" && (
          <>
            <Select label="Authorized by the sales order line" selectedKey={line || null} onSelectionChange={(next) => setLine(String(next ?? ""))} options={(options.data?.salesOrderLines ?? []).map((row) => ({ value: row.id, label: row.label }))}
              description={(options.data?.salesOrderLines ?? []).length ? undefined : "Link the customer's sales order to the project first."} />
            <TextField label="Recharge amount" inputMode="decimal" value={amount} onChange={setAmount} description={`Up to ${moneyLabel(e.baseAmount, e.baseCurrency)}; empty for the whole expense.`} />
          </>
        )}
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} onPress={save}>Save</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ the project's expenses (Time & Expenses)
function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "warning" | "danger" }) {
  return <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5"><span className="text-xs font-medium text-text-muted">{label}</span>
    <span className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : ""}`}>{value}</span>{note && <span className="text-xs text-text-muted">{note}</span>}</div>;
}
export function ProjectExpensesPanel({ projectId }: { projectId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const refresh = useRefresh();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "expense-summary", projectId), queryFn: () => getExpenseSummary(projectId), retry: false });
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "expenses", "project", projectId), enabled: summary.isSuccess,
    queryFn: () => listExpenses({ view: summary.data?.scope === "MINE" ? "mine" : "all", projectId, pageSize: 100 }) });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "expense-options", projectId), queryFn: () => getExpenseOptions(projectId), enabled: summary.isSuccess && (summary.data?.can.finance || summary.data?.can.lead) });
  const [dialog, setDialog] = useState<"new" | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (summary.isLoading) return <LoadingState label="Loading expenses" rows={3} />;
  if (!summary.data) return <Notice tone="danger">{errorMessage(summary.error)}</Notice>;
  const s = summary.data;
  const cur = s.currency;
  const rows = list.data?.items ?? [];
  const eligible = rows.filter((row) => row.billingStatus === "ELIGIBLE_UNBILLED" && row.financeStatus === "VERIFIED");
  const linkBill = () => setAsk({ title: "Link a supplier bill line", description: "The bill stays Finance's record; the project receives an allocation of its net value — never more than the line, never twice.",
    fields: [{ name: "line", label: "Supplier bill line id", kind: "text", required: true, description: "From Finance's bill (or use the search on an expense's Finance review)." }, { name: "amount", label: "Amount for this project (empty for the rest of the line)", kind: "quantity" }],
    confirm: "Link", run: async (v, key) => { await projectExpenseAction(projectId, "link-bill", { vendorBillLineId: String(v.line).trim(), amount: String(v.amount ?? "").trim() || undefined, idempotencyKey: key }); await refresh(); setMessage({ tone: "success", text: "Supplier bill linked." }); } });
  const linkIssue = () => setAsk({ title: "Link material issued to this project", description: "Inventory's value of a posted goods issue becomes project cost. No stock moves from here.",
    fields: [{ name: "issue", label: "Goods issue", kind: "select", required: true, options: (options.data?.goodsIssues ?? []).map((row) => ({ value: row.id, label: row.label })) }], confirm: "Link",
    run: async (v, key) => { await projectExpenseAction(projectId, "link-goods-issue", { goodsIssueId: String(v.issue), idempotencyKey: key }); await refresh(); setMessage({ tone: "success", text: "Material cost linked." }); } });
  const recharge = () => setAsk({ title: "Send rechargeable expenses to Sales", description: `${eligible.length} expense(s), ${moneyLabel(eligible.reduce((sum, row) => (Number(sum) + Number(row.rechargeAmount ?? 0)).toFixed(2), "0"), cur)}. Sales invoices them; nothing is invoiced from here.`,
    fields: [{ name: "note", label: "Note for Sales", kind: "textarea" }], confirm: "Send to Sales",
    run: async (v, key) => { await projectExpenseAction(projectId, "recharge", { expenseIds: eligible.map((row) => row.id), note: String(v.note ?? ""), idempotencyKey: key }); await refresh(); setMessage({ tone: "success", text: "Sent to Sales." }); } });
  return (
    <Panel title="Expenses" description={s.scope === "MINE" ? "Your claims on this project." : "Claims and costs of this project. Each figure is a separate stage of the same spending — they are not added together."}
      actions={<span className="flex flex-wrap gap-2">
        {s.can.create && <Button size="compact" variant="primary" onPress={() => setDialog("new")}>Add expense</Button>}
        {s.can.finance && <Button size="compact" variant="secondary" onPress={linkBill}>Link supplier bill</Button>}
        {(s.can.finance || s.can.lead) && (options.data?.goodsIssues ?? []).length > 0 && <Button size="compact" variant="secondary" onPress={linkIssue}>Link material issue</Button>}
        {s.can.billing && eligible.length > 0 && <Button size="compact" variant="secondary" onPress={recharge}>{`Recharge ${eligible.length}`}</Button>}
      </span>}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Figure label="Reported claims" value={moneyLabel(s.claims.reported, cur)} note={`${s.claims.count} claim(s)${Number(s.claims.draft) ? ` · ${moneyLabel(s.claims.draft, cur)} not submitted` : ""}`} />
        <Figure label="Awaiting approval" value={moneyLabel(s.claims.awaitingApproval, cur)} note={`${s.claims.awaitingCount} claim(s)`} tone={s.claims.awaitingCount ? "warning" : undefined} />
        <Figure label="Approved claims" value={moneyLabel(s.claims.approved, cur)} />
        {s.cost && <Figure label="Recognized project cost" value={moneyLabel(s.cost.recognized, cur)} note={Number(s.cost.pendingRecognition) ? `${moneyLabel(s.cost.pendingRecognition, cur)} awaiting Finance` : "Claims, supplier bills and materials"} />}
        {s.cost && <Figure label="Open purchase commitments" value={moneyLabel(s.cost.openCommitments, cur)} note="Not yet cost" />}
        {s.cost && <Figure label="Owed to employees" value={moneyLabel(s.cost.reimbursementsOutstanding, cur)} note={`${moneyLabel(s.cost.reimbursementsPaid, cur)} paid`} />}
        {s.billing && <Figure label="Rechargeable, not billed" value={moneyLabel(s.billing.eligible, cur)} note={`${moneyLabel(s.billing.reserved, cur)} with Sales`} />}
        {s.billing && <Figure label="Recharged (invoiced)" value={moneyLabel(s.billing.invoiced, cur)} />}
      </div>
      {s.cost && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="text-sm"><p className="text-xs font-medium text-text-muted">Cost by source</p>
            <ul className="mt-1 flex flex-col gap-0.5">{([["Expense claims", s.cost.bySource.EXPENSE_CLAIM], ["Supplier bills", s.cost.bySource.SUPPLIER_BILL], ["Materials (Inventory)", s.cost.bySource.GOODS_ISSUE]] as Array<[string, string]>).map(([label, value]) => (
              <li key={label} className="flex justify-between gap-2"><span>{label}</span><span className="tabular-nums">{moneyLabel(value, cur)}</span></li>))}
              {Number(s.cost.pendingSupplierBills) > 0 && <li className="flex justify-between gap-2 text-text-muted"><span>Supplier bills awaiting approval</span><span className="tabular-nums">{moneyLabel(s.cost.pendingSupplierBills, cur)}</span></li>}</ul></div>
          <div className="text-sm"><p className="text-xs font-medium text-text-muted">Cost by category</p>
            {s.cost.byCategory.length === 0 ? <p className="text-text-muted">No recognized cost yet.</p> : <ul className="mt-1 flex flex-col gap-0.5">{s.cost.byCategory.map((row) => <li key={row.category} className="flex justify-between gap-2"><span>{row.category}</span><span className="tabular-nums">{moneyLabel(row.amount, cur)}</span></li>)}</ul>}
            <p className="mt-1 text-xs text-text-muted">{s.cost.budget.message}</p></div>
        </div>
      )}
      {list.isLoading ? <LoadingState label="Loading" rows={3} /> : rows.length === 0 ? <p className="text-sm text-text-muted">No expenses recorded on this project yet.</p> : <ExpenseTable rows={rows} project />}
      {dialog === "new" && <ExpenseFormDialog projectId={projectId} onClose={() => setDialog(null)} onDone={(id) => router.push(`${EXPENSES_BASE}/${id}`)} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}

// ------------------------------------------------------------------ reports (a set of Project Reports)
export const EXPENSE_REPORT_TABS = [{ id: "ex-by-project", label: "By project" }, { id: "ex-by-category", label: "By category" }, { id: "ex-my-claims", label: "My claims" },
  { id: "ex-pending-approval", label: "Pending approval" }, { id: "ex-approved", label: "Approved" }, { id: "ex-reimbursement-status", label: "Reimbursements" }, { id: "ex-cost-by-source", label: "Cost by source" },
  { id: "ex-budget-vs-actual", label: "Budget vs actual" }, { id: "ex-billable-vs-nonbillable", label: "Billable vs not" }, { id: "ex-approved-unbilled", label: "Approved, unbilled" },
  { id: "ex-duplicates", label: "Duplicate exceptions" }, { id: "ex-by-employee", label: "By employee" }, { id: "ex-tax-review", label: "GST review" }, { id: "ex-corrections", label: "Corrections" },
  { id: "ex-reconciliation", label: "Reconciliation" }];
type Row = Record<string, unknown>;
const v = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
export function ExpenseReport({ kind, rows }: { kind: string; rows: Row[] }) {
  switch (kind) {
    case "ex-by-project": case "ex-by-category": case "ex-by-employee": return (
      <LinesTable columns={[kind === "ex-by-project" ? "Project" : kind === "ex-by-category" ? "Category" : "Employee", { label: "Claims", numeric: true }, { label: "Reported", numeric: true }, { label: "Awaiting", numeric: true }, { label: "Approved", numeric: true }]}>
        {rows.map((row) => <tr key={v(row.key)}><Cell>{v(row.label)}</Cell><Cell numeric>{v(row.claims)}</Cell><Cell numeric>{moneyLabel(v(row.reported))}</Cell><Cell numeric>{moneyLabel(v(row.awaiting))}</Cell><Cell numeric>{moneyLabel(v(row.approved))}</Cell></tr>)}
      </LinesTable>
    );
    case "ex-my-claims": case "ex-pending-approval": case "ex-approved": case "ex-reimbursement-status": case "ex-approved-unbilled": case "ex-tax-review": case "ex-duplicates": return rows.length ? <ExpenseTable rows={rows as unknown as Expense[]} /> : null;
    case "ex-billable-vs-nonbillable": return (
      <LinesTable columns={["Classification", { label: "Claims", numeric: true }, { label: "Amount", numeric: true }, { label: "Recharge", numeric: true }]}>
        {rows.map((row) => <tr key={v(row.key)}><Cell>{v(row.label)}</Cell><Cell numeric>{v(row.claims)}</Cell><Cell numeric>{moneyLabel(v(row.amount))}</Cell><Cell numeric>{moneyLabel(v(row.recharge))}</Cell></tr>)}
      </LinesTable>
    );
    case "ex-cost-by-source": case "ex-budget-vs-actual": case "ex-reconciliation": return (
      <LinesTable columns={["Project", { label: "Recognized", numeric: true }, { label: "Claims", numeric: true }, { label: "Supplier bills", numeric: true }, { label: "Materials", numeric: true }, { label: "Commitments", numeric: true },
        kind === "ex-reconciliation" ? "Reconciliation" : kind === "ex-budget-vs-actual" ? "Budget" : "Owed to employees"]}>
        {rows.map((row) => {
          const by = (row.bySource ?? {}) as Record<string, string>;
          const issues = row.issues as Record<string, number> | undefined;
          return <tr key={v(row.projectId)}><Cell><Link className="text-brand underline" href={`${PROJECTS_BASE}/${v(row.projectId)}?tab=time`}>{v(row.project)}</Link></Cell><Cell numeric>{moneyLabel(v(row.recognized))}</Cell>
            <Cell numeric>{moneyLabel(by.EXPENSE_CLAIM)}</Cell><Cell numeric>{moneyLabel(by.SUPPLIER_BILL)}</Cell><Cell numeric>{moneyLabel(by.GOODS_ISSUE)}</Cell><Cell numeric>{moneyLabel(v(row.openCommitments))}</Cell>
            <Cell>{kind === "ex-reconciliation" ? (row.balanced ? "Balanced" : Object.entries(issues ?? {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", "))
              : kind === "ex-budget-vs-actual" ? "No budget yet" : moneyLabel(v(row.reimbursementsOutstanding))}</Cell></tr>;
        })}
      </LinesTable>
    );
    case "ex-corrections": return (
      <LinesTable columns={["Correction", "Expense", "Kind", "Reason", "Status", "Requested by", "Follow-up"]}>
        {rows.map((row) => <tr key={v(row.id)}><Cell>{v(row.number)}</Cell><Cell><Link className="text-brand underline" href={`${EXPENSES_BASE}/${v(row.expenseId)}`}>{v(row.expense)}</Link></Cell><Cell>{v(row.kind)}</Cell><Cell>{v(row.reason)}</Cell>
          <Cell>{v(row.status)}</Cell><Cell>{v(row.requestedBy)}</Cell><Cell>{((row.flags as string[]) ?? []).join(", ").toLowerCase().replace(/_/g, " ") || "—"}</Cell></tr>)}
      </LinesTable>
    );
    default: return null;
  }
}

// ------------------------------------------------------------------ settings
export function ExpenseSettingsPanel() {
  const workspace = useWorkspaceContext();
  const refresh = useRefresh();
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "expense-settings"), queryFn: getExpenseSettings, retry: false });
  const [draft, setDraft] = useState<{ financeReviewRequired?: boolean; receiptThreshold?: string; managerLimit?: string | null; deadlineDays?: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!settings.data) return null;
  const s = settings.data;
  const value = { financeReviewRequired: draft?.financeReviewRequired ?? s.financeReviewRequired, receiptThreshold: draft?.receiptThreshold ?? s.receiptThreshold, managerLimit: draft?.managerLimit !== undefined ? draft.managerLimit : s.managerLimit,
    deadlineDays: draft?.deadlineDays ?? String(s.deadlineDays) };
  const save = async () => {
    setBusy(true); setMessage(null);
    try { await saveExpenseSettings({ financeReviewRequired: value.financeReviewRequired, receiptThreshold: value.receiptThreshold, managerLimit: value.managerLimit || null, deadlineDays: Number(value.deadlineDays) } as never); await refresh(); setDraft(null); setMessage({ tone: "success", text: "Expense policy saved." }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  return (
    <Panel title="Expenses" description="How project expense claims are reviewed. Finance always decides tax and accounting; nothing is posted or paid from Projects.">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={`Receipts required above (${s.currency})`} isDisabled={!s.can.manage} inputMode="decimal" value={value.receiptThreshold} onChange={(next) => setDraft({ ...draft, receiptThreshold: next })} description="0 means every claim needs one." />
        <TextField label={`Project manager's approval limit (${s.currency})`} isDisabled={!s.can.manage} inputMode="decimal" value={value.managerLimit ?? ""} onChange={(next) => setDraft({ ...draft, managerLimit: next })}
          description="Above it, the business owner approves. Empty for no limit." />
        <TextField label="Claim within (days)" isDisabled={!s.can.manage} inputMode="numeric" value={value.deadlineDays} onChange={(next) => setDraft({ ...draft, deadlineDays: next })} />
      </div>
      <Checkbox isDisabled={!s.can.manage} isSelected={value.financeReviewRequired} onChange={(on) => setDraft({ ...draft, financeReviewRequired: on })}>Finance verifies every approved expense before it becomes project cost</Checkbox>
      {s.can.manage && <div className="flex justify-end"><Button variant="primary" isLoading={busy} isDisabled={busy || !draft} onPress={save}>Save expense policy</Button></div>}
    </Panel>
  );
}
