"use client";

// Settings → Finance & Commercial → Payment Terms: the shared master Sales, Procurement and Finance choose from. A term never pays anything:
// it says when each part of a document is due. While nothing uses a term its rules are edited in place; once used, a change is a new version
// (with a reason) and documents keep the version they were agreed with. Terms are deactivated, never deleted.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import {
  Button, Checkbox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, SearchField, Select, StatusBadge, TextArea, TextField,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  clearDefault, createPaymentTerm, errorMessage, getPaymentTerm, listPaymentTerms, previewPaymentTerm, termAction, updatePaymentTerm, type PaymentTerm, type PaymentTermList, type Preview, type Rule,
  type TermType,
} from "../api/payment-terms-api";

const VIEWS = [{ id: "all", label: "All Terms" }, { id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }];
const day = (value: string | null | undefined) => (value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const Alert = ({ children, tone = "danger" }: { children: React.ReactNode; tone?: "danger" | "info" }) => (
  <p role="alert" className={`rounded-[var(--radius-control)] border px-3 py-2 text-sm ${tone === "danger" ? "border-danger-emphasis/30 bg-danger-soft text-danger" : "border-border bg-surface-subtle text-text-secondary"}`}>{children}</p>
);

export function PaymentTermsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PaymentTerm | "new" | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filters = useMemo(() => ({ status: view === "all" ? undefined : view, search: search.trim() || undefined }), [view, search]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "settings", "payment-terms", filters), queryFn: () => listPaymentTerms(filters) });
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "settings", "payment-terms") }); };
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "deactivate" | "default-sales" | "default-purchase" }) => termAction(id, action),
    onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)),
  });
  const data = query.data;
  const capabilities = data?.capabilities;
  const rows = data?.rows ?? [];
  const columns = useMemo<ColumnDef<PaymentTerm, unknown>[]>(() => [
    { id: "code", header: "Code", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.code}</span> },
    { id: "name", header: "Name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}{row.original.version > 1 && <span className="ml-1 text-xs text-text-muted">v{row.original.version}</span>}</span> },
    { id: "type", header: "Type", cell: ({ row }) => row.original.termTypeLabel },
    { id: "rules", header: "Description", cell: ({ row }) => <span className="text-text-secondary">{row.original.description ?? row.original.summary}
      {row.original.advancePercentage && <span className="block text-xs">{row.original.advancePercentage}% advance</span>}</span> },
    { id: "company", header: "Company", cell: ({ row }) => <span className="text-text-secondary">{row.original.company}</span> },
    { id: "default", header: "Default", cell: ({ row }) => <span className="flex flex-wrap gap-1">{row.original.isDefaultSales && <StatusBadge tone="info">Sales</StatusBadge>}
      {row.original.isDefaultPurchase && <StatusBadge tone="info">Purchases</StatusBadge>}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? "Active" : "Inactive"}</StatusBadge> },
    { id: "updated", header: "Updated", cell: ({ row }) => <span className="whitespace-nowrap text-text-secondary">{day(row.original.updatedAt)}</span> },
    { id: "actions", header: "", cell: ({ row }) => (
      <span className="flex flex-wrap justify-end gap-1" onClick={(event) => event.stopPropagation()}>
        {capabilities?.manage && <Button size="compact" variant="ghost" onPress={() => setEditing(row.original)}>{row.original.inUse ? "New version" : "Edit"}</Button>}
        {capabilities?.setDefault && row.original.status === "active" && !row.original.buyingRegistrationId && row.original.purchaseEnabled && !row.original.isDefaultPurchase
          && <Button size="compact" variant="ghost" onPress={() => act.mutate({ id: row.original.id, action: "default-purchase" })}>Default for purchases</Button>}
        {capabilities?.setDefault && row.original.status === "active" && !row.original.buyingRegistrationId && row.original.salesEnabled && !row.original.isDefaultSales
          && <Button size="compact" variant="ghost" onPress={() => act.mutate({ id: row.original.id, action: "default-sales" })}>Default for sales</Button>}
        {capabilities?.manage && <Button size="compact" variant="ghost" onPress={() => act.mutate({ id: row.original.id, action: row.original.status === "active" ? "deactivate" : "activate" })}>
          {row.original.status === "active" ? "Deactivate" : "Activate"}</Button>}
      </span>
    ) },
  ], [capabilities, act]);
  return (
    <EnterpriseListPage header={{ title: "Payment Terms",
      description: "When suppliers and customers are paid: immediately, net days, from the invoice received date, end of month, a fixed day of a month, instalments or an advance. Shared by Sales, Procurement and Finance; documents keep the terms they were agreed with.",
      primaryAction: capabilities?.manage ? <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New Payment Term</Button> : undefined }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: setView }}
      actionBar={{ start: <SearchField aria-label="Search payment terms" placeholder="Code, name or description" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}>
      {error && <Alert>{error}</Alert>}
      <EnterpriseDataGrid<PaymentTerm> aria-label="Payment terms" columns={columns} data={rows} getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<LoadingState label="Loading payment terms" rows={6} />}
        errorContent={<ErrorState title="Could not load payment terms" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="No payment terms" description="Create the terms your suppliers and customers are paid on." />}
        onRowClick={(row) => setViewing(row.id)}
        renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium">{row.code} · {row.name}</span><span className="text-xs text-text-muted">{row.summary}</span></div>} />
      {(data?.rows.some((row) => row.isDefaultPurchase) || data?.rows.some((row) => row.isDefaultSales)) && capabilities?.setDefault && (
        <div className="flex flex-wrap gap-2 pt-2 text-sm">
          {data?.rows.some((row) => row.isDefaultPurchase) && <Button size="compact" variant="ghost" onPress={() => void clearDefault("purchase").then(refresh)}>Clear the purchases default</Button>}
          {data?.rows.some((row) => row.isDefaultSales) && <Button size="compact" variant="ghost" onPress={() => void clearDefault("sales").then(refresh)}>Clear the sales default</Button>}
        </div>
      )}
      {editing && data && <TermEditor term={editing === "new" ? null : editing} list={data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {viewing && <TermHistory termId={viewing} onClose={() => setViewing(null)} />}
    </EnterpriseListPage>
  );
}

const SINGLE_KIND: Partial<Record<TermType, Rule["kind"]>> = { immediate: "days", net_days: "days", invoice_receipt: "days", end_of_month: "end_of_month", fixed_day: "fixed_day" };
const blankRule = (kind: Rule["kind"] = "days", percentage = "100"): Rule => ({ percentage, basis: "invoice_date", kind, days: kind === "fixed_day" ? 0 : 30, monthsOffset: kind === "days" ? 0 : 1,
  dayOfMonth: kind === "fixed_day" ? 15 : null });

function TermEditor({ term, list, onClose, onSaved }: { term: PaymentTerm | null; list: PaymentTermList; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState({ code: term?.code ?? "", name: term?.name ?? "", description: term?.description ?? "", termType: (term?.termType ?? "net_days") as TermType,
    advancePercentage: term?.advancePercentage ?? "", buyingRegistrationId: term?.buyingRegistrationId ?? "all", salesEnabled: term?.salesEnabled ?? true, purchaseEnabled: term?.purchaseEnabled ?? true,
    versionReason: "" });
  const [rules, setRules] = useState<Rule[]>(term?.rules.length ? term.rules : [blankRule()]);
  const [sample, setSample] = useState({ total: "118000", invoiceDate: new Date().toISOString().slice(0, 10), invoiceReceivedDate: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const single = SINGLE_KIND[values.termType];
  const effectiveRules = values.termType === "custom" ? [] : values.termType === "immediate" ? [{ ...blankRule("days"), days: 0 }] : single ? [{ ...rules[0], kind: single, percentage: "100",
    basis: values.termType === "invoice_receipt" ? "invoice_received" as const : rules[0].basis }] : rules;
  const body = () => ({ ...values, rules: effectiveRules, buyingRegistrationId: values.buyingRegistrationId === "all" ? null : values.buyingRegistrationId,
    advancePercentage: values.termType === "advance" ? values.advancePercentage : null, ...(term?.inUse ? { newVersion: true } : {}) });
  const save = useMutation({ mutationFn: () => (term ? updatePaymentTerm(term.id, body()) : createPaymentTerm(body())), onSuccess: onSaved });
  const calculate = useMutation({ mutationFn: () => previewPaymentTerm({ termType: values.termType, rules: effectiveRules, total: sample.total, invoiceDate: sample.invoiceDate,
    invoiceReceivedDate: sample.invoiceReceivedDate || undefined }), onSuccess: setPreview });
  const set = (key: keyof typeof values) => (value: string | boolean) => { setValues((current) => ({ ...current, [key]: value })); setPreview(null); };
  const setRule = (index: number, patch: Partial<Rule>) => { setRules((current) => current.map((rule, at) => (at === index ? { ...rule, ...patch } : rule))); setPreview(null); };
  const total = effectiveRules.reduce((sum, rule) => sum + (Number(rule.percentage) || 0), 0);
  const kinds = list.ruleKinds.map((entry) => ({ value: entry.code, label: entry.label }));
  const bases = list.referenceBases.map((entry) => ({ value: entry.code, label: entry.label }));
  const many = values.termType === "installments" || values.termType === "advance";
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={term ? (term.inUse ? `New version of ${term.code}` : `Edit ${term.code}`) : "Create Payment Term"}
      description={term?.inUse ? `${term.name} is used by ${term.suppliers} supplier(s), ${term.customers} customer(s) and ${term.documents} document(s): the change becomes version ${term.version + 1}; documents keep theirs.` : undefined} size="xl">
      <div className="flex flex-col gap-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Payment term name" value={values.name} onChange={set("name")} />
          <TextField label="Term code" isDisabled={Boolean(term)} value={values.code} onChange={(value) => set("code")(value.toUpperCase())} description="For example NET30, EOM15, INST50." />
          <Select label="Type" selectedKey={values.termType} onSelectionChange={(value) => { set("termType")(String(value)); if (value === "installments" && rules.length < 2) setRules([blankRule("days", "50"), { ...blankRule("days", "50"), days: 30 }]); }}
            options={list.termTypes.map((entry) => ({ value: entry.code, label: entry.label }))} />
        </div>
        <TextArea label="Description (shown to people choosing the term)" value={values.description} onChange={set("description")} />
        {values.termType === "custom" ? <Alert tone="info">A custom term is described in words: no due date is worked out; each document&apos;s due date is entered.</Alert> : (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{many ? "Payment schedule rules" : "Due date rule"}{values.termType === "advance" ? " (for the bill, after the advance)" : ""}</span>
            {(single ? effectiveRules : rules).map((rule, index) => (
              <div key={index} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-12">
                {many && <div className="sm:col-span-2"><TextField label={`Share ${index + 1} (%)`} inputMode="decimal" value={rule.percentage} onChange={(value) => setRule(index, { percentage: value })} /></div>}
                {!single && <div className="sm:col-span-3"><Select label="Due" selectedKey={rule.kind} onSelectionChange={(value) => setRule(index, { ...blankRule(String(value) as Rule["kind"], rule.percentage), basis: rule.basis })} options={kinds} /></div>}
                {values.termType !== "immediate" && values.termType !== "invoice_receipt" && (
                  <div className="sm:col-span-3"><Select label="Counted from" selectedKey={rule.basis} onSelectionChange={(value) => setRule(index, { basis: String(value) as Rule["basis"] })} options={bases} /></div>
                )}
                {rule.kind !== "fixed_day" && values.termType !== "immediate" && (
                  <div className="sm:col-span-2"><TextField label={rule.kind === "end_of_month" ? "+ days after month end" : "Days"} inputMode="numeric" value={String(rule.days)} onChange={(value) => setRule(index, { days: Number(value) || 0 })} /></div>
                )}
                {rule.kind !== "days" && <div className="sm:col-span-2"><Select label="Month" selectedKey={String(rule.monthsOffset)} onSelectionChange={(value) => setRule(index, { monthsOffset: Number(value) })}
                  options={[0, 1, 2, 3].map((offset) => ({ value: String(offset), label: offset === 0 ? "Same month" : offset === 1 ? "Following month" : `+${offset} months` }))} /></div>}
                {rule.kind === "fixed_day" && <div className="sm:col-span-2"><TextField label="Day of month" inputMode="numeric" value={String(rule.dayOfMonth ?? "")} onChange={(value) => setRule(index, { dayOfMonth: Number(value) || null })}
                  description="31 in a short month: its last day." /></div>}
                {many && rules.length > 1 && <div className="sm:col-span-1"><Button size="compact" variant="ghost" aria-label="Remove rule" onPress={() => setRules((current) => current.filter((_, at) => at !== index))}><Trash2 className="size-4" aria-hidden="true" /></Button></div>}
              </div>
            ))}
            {many && (
              <div className="flex items-center justify-between text-sm">
                <Button size="compact" variant="secondary" onPress={() => setRules((current) => [...current, { ...blankRule(), percentage: "0" }])}>Add instalment</Button>
                <span className={Math.abs(total - 100) < 0.0001 ? "text-success" : "text-danger"}>Total allocation {total}%</span>
              </div>
            )}
          </div>
        )}
        {values.termType === "advance" && <TextField label="Advance (% of the order, paid before the bill)" inputMode="decimal" value={values.advancePercentage} onChange={set("advancePercentage")}
          description="Finance pays it as a supplier advance against the purchase order and applies it to the bill." />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Company" selectedKey={values.buyingRegistrationId} onSelectionChange={(value) => set("buyingRegistrationId")(String(value))}
            options={[{ value: "all", label: "All companies" }, ...list.registrations.map((entry) => ({ value: entry.id, label: entry.name }))]} />
          <Checkbox isSelected={values.purchaseEnabled} onChange={set("purchaseEnabled")}>Available for purchases</Checkbox>
          <Checkbox isSelected={values.salesEnabled} onChange={set("salesEnabled")}>Available for sales</Checkbox>
        </div>
        {term?.inUse && <TextField label="Reason for the new version" value={values.versionReason} onChange={set("versionReason")} />}
        {values.termType !== "custom" && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
            <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-4">
              <TextField label="Preview for a bill of" inputMode="decimal" value={sample.total} onChange={(value) => setSample((current) => ({ ...current, total: value }))} />
              <TextField label="Dated" type="date" value={sample.invoiceDate} onChange={(value) => setSample((current) => ({ ...current, invoiceDate: value }))} />
              <TextField label="Received on" type="date" value={sample.invoiceReceivedDate} onChange={(value) => setSample((current) => ({ ...current, invoiceReceivedDate: value }))} />
              <Button variant="secondary" isLoading={calculate.isPending} onPress={() => calculate.mutate()}>Preview</Button>
            </div>
            {calculate.error && <Alert>{errorMessage(calculate.error)}</Alert>}
            {preview && (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {preview.lines.map((line) => <li key={line.sequence} className="flex justify-between py-1"><span>{line.missing ? "Needs the invoice received date" : day(line.dueDate)}
                  <span className="text-text-muted"> · {Number(line.percentage)}%</span></span><span className="tabular-nums">{Number(line.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></li>)}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!values.name.trim() || (!term && !values.code.trim()) || (many && Math.abs(total - 100) > 0.0001)} onPress={() => save.mutate()}>
            {term?.inUse ? "Save new version" : "Save"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function TermHistory({ termId, onClose }: { termId: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["settings", "payment-term", termId], queryFn: () => getPaymentTerm(termId) });
  const detail = query.data;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={detail ? `${detail.term.code} · ${detail.term.name}` : "Payment term"} size="lg">
      {!detail ? <LoadingState label="Loading" /> : (
        <div className="flex flex-col gap-3 text-sm">
          <p>{detail.term.summary}{detail.term.advancePercentage ? ` · ${detail.term.advancePercentage}% advance` : ""}</p>
          <p className="text-text-secondary">{detail.term.company} · used by {detail.term.suppliers} supplier(s), {detail.term.customers} customer(s) and {detail.term.documents} document(s)</p>
          <div>
            <span className="font-medium">Versions</span>
            <ul className="mt-1 flex flex-col divide-y divide-border">
              {detail.versions.map((entry) => <li key={entry.version} className="py-1">v{entry.version} · {entry.summary}<span className="block text-xs text-text-muted">{day(entry.createdAt)}{entry.createdByName ? ` · ${entry.createdByName}` : ""}{entry.reason ? ` · ${entry.reason}` : ""}</span></li>)}
            </ul>
          </div>
          <div>
            <span className="font-medium">History</span>
            <ul className="mt-1 flex flex-col divide-y divide-border">
              {detail.events.map((entry) => <li key={entry.id} className="py-1">{entry.event_type.replace("payment_term.", "").replace(/_/g, " ")}<span className="block text-xs text-text-muted">{day(entry.occurred_at)}{entry.actor_name ? ` · ${entry.actor_name}` : ""}</span></li>)}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}
