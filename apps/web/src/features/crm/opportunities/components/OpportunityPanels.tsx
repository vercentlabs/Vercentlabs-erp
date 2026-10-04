"use client";

// The sections of an opportunity page that hold records of their own:
// products, contacts, quotations, the work done and planned, and the
// histories. Each reads and writes through the opportunity operations.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, ComboBox, Dialog, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import { DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatDate, formatDateTime, formatMoney, humanize } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  addOpportunityContact, addOpportunityProduct, errorMessage, listOpportunityActivities, listOpportunityAssignmentHistory, listOpportunityContacts,
  listOpportunityHistory, listOpportunityProducts, listOpportunityQuotations, listOpportunityStageHistory, logOpportunityActivity, quotationDraftStorageKey,
  removeOpportunityContact, removeOpportunityProduct, searchOpportunityProducts, setPrimaryOpportunityQuotation,
  startOpportunityQuotation, updateOpportunity, updateOpportunityContact, updateOpportunityProduct,
  type Opportunity, type OpportunityOptions, type OpportunityProductLine,
} from "../api/opportunities-api";
import { ErrorBanner } from "../opportunity-format";

type PanelProps = { opportunity: Opportunity; options: OpportunityOptions; canEdit: boolean; onChanged: () => void };
const NONE = "";
const FOLLOW_UP_LABELS: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", task: "Task", other: "Other" };
const empty = (text: string) => <p className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">{text}</p>;

function useKey(opportunityId: string, part: string) {
  const workspace = useWorkspaceContext();
  return scopedQueryKey(workspace, "crm", "opportunity", opportunityId, part);
}

// ------------------------------------------------------------------ products

export function OpportunityProductsPanel({ opportunity, canEdit, onChanged }: PanelProps) {
  const queryClient = useQueryClient();
  const key = useKey(opportunity.id, "products");
  const query = useQuery({ queryKey: key, queryFn: () => listOpportunityProducts(opportunity.id) });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: key }); onChanged(); };
  const change = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const lines = query.data?.lines ?? [];
  const total = query.data?.total ?? 0;
  const currency = opportunity.currencyCode ?? undefined;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">What is being sold, with estimated prices. A quotation created from this opportunity starts from these lines.</p>
        {canEdit && <Button variant="secondary" size="compact" onPress={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" />Add product</Button>}
      </div>
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading products" rows={3} /> : lines.length === 0 ? empty("No products on this opportunity yet.") : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-text-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">Product / service</th>
                {["Quantity", "Estimated price", "Discount %", "Line value"].map((heading) => <th key={heading} className="px-3 py-2 text-right font-medium">{heading}</th>)}
                {canEdit && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line) => (
                <ProductRow key={line.id} line={line} currency={currency} canEdit={canEdit} isBusy={change.isPending}
                  onSave={(input) => change.mutate(() => updateOpportunityProduct(opportunity.id, line.id, input))}
                  onRemove={() => change.mutate(() => removeOpportunityProduct(opportunity.id, line.id))} />
              ))}
            </tbody>
            <tfoot className="border-t border-border bg-surface-muted font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={4}>Expected total</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(currency, total)}</td>
                {canEdit && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {canEdit && lines.length > 0 && total !== opportunity.amount && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-text-secondary">The estimated value of this deal is {formatMoney(currency, opportunity.amount)}.</span>
          <Button variant="outline" size="compact" isDisabled={change.isPending} onPress={() => change.mutate(() => updateOpportunity(opportunity.id, { amount: total }))}>
            Set it to the products total
          </Button>
        </div>
      )}
      {adding && <AddProductDialog opportunityId={opportunity.id} currency={currency} onClose={() => setAdding(false)} onAdded={refresh} />}
    </section>
  );
}

function ProductRow({ line, currency, canEdit, isBusy, onSave, onRemove }: {
  line: OpportunityProductLine; currency: string | undefined; canEdit: boolean; isBusy: boolean;
  onSave: (input: Record<string, unknown>) => void; onRemove: () => void;
}) {
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [unitPrice, setUnitPrice] = useState(String(line.unitPrice));
  const [discount, setDiscount] = useState(String(line.discountPercent));
  const dirty = Number(quantity) !== line.quantity || Number(unitPrice) !== line.unitPrice || Number(discount) !== line.discountPercent;
  const input = "w-24";
  return (
    <tr>
      <td className="px-3 py-2"><span className="font-medium">{line.productName}</span>{line.description && <span className="block text-text-secondary">{line.description}</span>}</td>
      {canEdit ? (
        <>
          <td className="px-3 py-2"><div className="flex justify-end"><TextField aria-label="Quantity" className={input} inputMode="decimal" value={quantity} onChange={setQuantity} /></div></td>
          <td className="px-3 py-2"><div className="flex justify-end"><TextField aria-label="Estimated price" className="w-32" inputMode="decimal" value={unitPrice} onChange={setUnitPrice} /></div></td>
          <td className="px-3 py-2"><div className="flex justify-end"><TextField aria-label="Discount percent" className={input} inputMode="decimal" value={discount} onChange={setDiscount} /></div></td>
        </>
      ) : (
        <>
          <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(currency, line.unitPrice)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{line.discountPercent}</td>
        </>
      )}
      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(currency, line.lineTotal)}</td>
      {canEdit && (
        <td className="px-3 py-2">
          <span className="flex justify-end gap-1">
            {dirty && <Button variant="secondary" size="compact" isDisabled={isBusy} onPress={() => onSave({ quantity, unitPrice, discountPercent: discount })}>Save</Button>}
            <Button variant="ghost" size="compact" aria-label={`Remove ${line.productName ?? "product"}`} isDisabled={isBusy} onPress={onRemove}><Trash2 className="size-4" aria-hidden="true" /></Button>
          </span>
        </td>
      )}
    </tr>
  );
}

function AddProductDialog({ opportunityId, currency, onClose, onAdded }: { opportunityId: string; currency: string | undefined; onClose: () => void; onAdded: () => void }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [discount, setDiscount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const products = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-products", search), queryFn: () => searchOpportunityProducts(search), staleTime: 15_000 });
  const mutation = useMutation({
    mutationFn: () => addOpportunityProduct(opportunityId, { productId, quantity, ...(unitPrice.trim() ? { unitPrice } : {}), ...(discount.trim() ? { discountPercent: discount } : {}) }),
    onSuccess: () => { onAdded(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const chosen = products.data?.find((entry) => entry.id === productId);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Add product or service">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <ComboBox label="Product / service" isRequired placeholder="Search products and services" selectedKey={productId} inputValue={search} onInputChange={setSearch}
          options={(products.data ?? []).map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.code})` }))}
          onSelectionChange={(key) => {
            const id = key ? String(key) : null;
            setProductId(id);
            const picked = products.data?.find((entry) => entry.id === id);
            if (picked) { setSearch(`${picked.name} (${picked.code})`); setUnitPrice(String(picked.salesPrice || "")); }
          }} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Quantity" inputMode="decimal" value={quantity} onChange={setQuantity} />
          <TextField label={`Estimated price${currency ? ` (${currency})` : ""}`} inputMode="decimal" value={unitPrice} onChange={setUnitPrice}
            description={chosen ? `List price ${formatMoney(currency, chosen.salesPrice)}` : undefined} />
          <TextField label="Discount %" inputMode="decimal" value={discount} onChange={setDiscount} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!productId}>Add product</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ contacts

export function OpportunityContactsPanel({ opportunity, options, canEdit, onChanged }: PanelProps) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = useKey(opportunity.id, "contacts");
  const query = useQuery({ queryKey: key, queryFn: () => listOpportunityContacts(opportunity.id) });
  // The people who can be added: contacts of this deal's account.
  const accountContacts = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account-contacts", opportunity.accountId),
    queryFn: () => listContacts({ accountId: opportunity.accountId ?? undefined, limit: 100 }),
    enabled: canEdit && Boolean(opportunity.accountId),
  });
  const [contactId, setContactId] = useState(NONE);
  const [role, setRole] = useState(NONE);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); setContactId(NONE); setRole(NONE); void queryClient.invalidateQueries({ queryKey: key }); onChanged(); };
  const change = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const contacts = query.data ?? [];
  const available = (accountContacts.data?.rows ?? []).filter((row) => !contacts.some((entry) => entry.contactId === row.id));

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">The primary contact and the other people involved in the decision. They are contacts of {opportunity.accountName ?? "the account"}.</p>
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading contacts" rows={2} /> : contacts.length === 0 ? empty("No contacts on this opportunity yet.") : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {contacts.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/crm/contacts/${entry.contactId}`} className="font-medium text-brand underline-offset-2 hover:underline">{entry.name}</Link>
                  {entry.isPrimary && <Badge tone="brand">Primary</Badge>}
                  {entry.roleLabel && <Badge tone="neutral">{entry.roleLabel}</Badge>}
                  {entry.isInactive && <Badge tone="warning">Inactive</Badge>}
                </span>
                <span className="text-text-secondary">{[entry.jobTitle, entry.email, entry.mobile].filter(Boolean).join(" · ")}</span>
              </div>
              {canEdit && (
                <span className="flex flex-wrap gap-1">
                  {!entry.isPrimary && <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => change.mutate(() => updateOpportunityContact(opportunity.id, entry.id, { isPrimary: true }))}>Make primary</Button>}
                  <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => change.mutate(() => removeOpportunityContact(opportunity.id, entry.id))}>Remove</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Select label="Add a contact" selectedKey={contactId} onSelectionChange={(selected) => setContactId(String(selected ?? NONE))}
            options={[{ value: NONE, label: available.length ? "Choose a contact" : "No other contacts at this account" }, ...available.map((row) => ({ value: row.id, label: row.displayName }))]} />
          <Select label="Role" selectedKey={role} onSelectionChange={(selected) => setRole(String(selected ?? NONE))}
            options={[{ value: NONE, label: "No role" }, ...options.contactRoles.map((entry) => ({ value: entry.code, label: entry.label }))]} />
          <Button variant="secondary" isDisabled={!contactId || change.isPending} onPress={() => change.mutate(() => addOpportunityContact(opportunity.id, { contactId, role: role || null }))}>Add</Button>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ quotations

// "Create quotation": the opportunity hands Sales its customer, contact,
// currency, salesperson and product lines, and the quotation form opens with them.
// The opportunity is given when the action runs, so one hook serves a page of cards.
export function useStartQuotation(onError: (message: string) => void) {
  const router = useRouter();
  return useMutation({
    mutationFn: (opportunity: Pick<Opportunity, "id" | "name">) => startOpportunityQuotation(opportunity.id),
    onSuccess: (draft, opportunity) => {
      try { window.sessionStorage.setItem(quotationDraftStorageKey(opportunity.id), JSON.stringify(draft)); } catch { /* the form simply starts without lines */ }
      const params = new URLSearchParams({ customer: draft.partyId, opportunity: opportunity.id, opportunityName: opportunity.name });
      if (draft.contactId) params.set("contact", draft.contactId);
      router.push(`/sales/quotations/new?${params.toString()}`);
    },
    onError: (failure) => onError(errorMessage(failure)),
  });
}

export function OpportunityQuotationsPanel({ opportunity, options, canEdit, onChanged }: PanelProps) {
  const queryClient = useQueryClient();
  const key = useKey(opportunity.id, "quotations");
  const query = useQuery({ queryKey: key, queryFn: () => listOpportunityQuotations(opportunity.id) });
  const [error, setError] = useState<string | null>(null);
  const canQuote = options.capabilities.createQuotation && opportunity.status === "open" && !opportunity.archivedAt;
  const start = useStartQuotation(setError);
  const primary = useMutation({
    mutationFn: (quotationId: string | null) => setPrimaryOpportunityQuotation(opportunity.id, quotationId),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: key }); onChanged(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const quotations = query.data ?? [];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">A deal can have several quotations. Creating one does not win the deal; mark it won when the customer agrees.</p>
        {canQuote && <Button variant="primary" size="compact" onPress={() => start.mutate(opportunity)} isLoading={start.isPending}><Plus className="size-4" aria-hidden="true" />Create quotation</Button>}
      </div>
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading quotations" rows={2} /> : quotations.length === 0 ? empty("No quotations yet.") : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {quotations.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/sales/quotations/${entry.id}`} className="font-medium text-brand underline-offset-2 hover:underline">{entry.number} · v{entry.version}</Link>
                  <StatusBadge tone={entry.status === "accepted" || entry.status === "converted" ? "success" : entry.status === "cancelled" ? "neutral" : "info"}>{humanize(entry.status)}</StatusBadge>
                  {entry.isWinning && <Badge tone="success">Winning</Badge>}
                  {entry.isPrimary && <Badge tone="brand">Primary</Badge>}
                  {entry.isLatest && !entry.isPrimary && <Badge tone="neutral">Latest</Badge>}
                </span>
                <span className="text-text-secondary">
                  {[entry.total !== null ? formatMoney(entry.currencyCode ?? undefined, entry.total) : null, entry.validUntil ? `Valid until ${formatDate(entry.validUntil)}` : null,
                    `Created ${formatDate(entry.createdAt)}`, entry.salesOrderNumber ? `Sales order ${entry.salesOrderNumber}` : null].filter(Boolean).join(" · ")}
                </span>
              </div>
              {canEdit && !entry.isPrimary && <Button variant="ghost" size="compact" isDisabled={primary.isPending} onPress={() => primary.mutate(entry.id)}>Make primary</Button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ work: activities, tasks, follow-ups

// The activities logged on the deal. Tasks and follow-ups have their own panels (CRM Tasks, CRM Follow-ups).
export function OpportunityWorkPanel({ opportunity, canEdit }: PanelProps & { kind: "activities" }) {
  const key = useKey(opportunity.id, "activities");
  const query = useQuery({ queryKey: key, queryFn: () => listOpportunityActivities(opportunity.id) });
  const all = query.data ?? [];
  const rows = all.filter((entry) => !["task", "follow_up"].includes(entry.type));
  const label = "activities logged";
  return (
    <section className="flex flex-col gap-3">
      {!canEdit && opportunity.status !== "open" && <p className="text-sm text-text-secondary">This opportunity is {opportunity.status}. Reopen it to plan more work.</p>}
      {query.isLoading ? <LoadingState label={`Loading ${label}`} rows={3} /> : rows.length === 0 ? empty(`No ${label} yet.`) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {rows.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{entry.subject}</span>
                <StatusBadge tone={entry.status === "completed" ? "success" : entry.status === "overdue" ? "danger" : "info"}>{humanize(entry.status)}</StatusBadge>
              </span>
              {entry.outcome && <span>Outcome: {entry.outcome}</span>}
              {entry.notes && <span className="whitespace-pre-wrap text-text-secondary">{entry.notes}</span>}
              <span className="text-xs text-text-muted">
                {entry.completedAt ? `Done ${formatDateTime(entry.completedAt)}` : entry.dueAt ? `Due ${formatDateTime(entry.dueAt)}` : formatDateTime(entry.createdAt)}
                {entry.assignedName ? ` · ${entry.assignedName}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LogActivityDialog({ isOpen, onOpenChange, opportunity, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; opportunity: Opportunity; options: OpportunityOptions; onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const key = useKey(opportunity.id, "activities");
  const contactsKey = useKey(opportunity.id, "contacts");
  const contacts = useQuery({ queryKey: contactsKey, queryFn: () => listOpportunityContacts(opportunity.id), enabled: isOpen });
  const [type, setType] = useState("call");
  const [subject, setSubject] = useState("");
  const [contactId, setContactId] = useState(NONE);
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [nextType, setNextType] = useState(NONE);
  const [nextDueAt, setNextDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => logOpportunityActivity(opportunity.id, {
      type, subject, outcome, notes, occurredAt: occurredAt || undefined, contactId: contactId || undefined,
      ...(nextType ? { nextAction: { type: nextType, dueAt: nextDueAt } } : {}),
    }),
    onSuccess: () => {
      setSubject(""); setOutcome(""); setNotes(""); setOccurredAt(""); setNextType(NONE); setNextDueAt(""); setError(null);
      void queryClient.invalidateQueries({ queryKey: key });
      onDone();
      onOpenChange(false);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Log activity" description="Record something that has already happened." size="lg">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" isRequired selectedKey={type} onSelectionChange={(selected) => setType(String(selected))}
            options={options.activityTypes.map((entry) => ({ value: entry.code, label: entry.label }))} />
          <DateTimeInput label="When" description="Leave empty for now." value={occurredAt} onChange={setOccurredAt} />
          <Select label="Contact" selectedKey={contactId} onSelectionChange={(selected) => setContactId(String(selected ?? NONE))}
            options={[{ value: NONE, label: "No contact" }, ...(contacts.data ?? []).map((entry) => ({ value: entry.contactId, label: entry.name }))]} />
          <TextField label="Subject" description="Leave empty to use the type and the opportunity name." value={subject} onChange={setSubject} />
        </div>
        <TextField label="Outcome" value={outcome} onChange={setOutcome} placeholder="For example: Customer asked for a revised scope" />
        <TextArea label="Notes" value={notes} onChange={setNotes} />
        {opportunity.status === "open" && (
          <div className="grid gap-4 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-2">
            <Select label="Next action" selectedKey={nextType} onSelectionChange={(selected) => setNextType(String(selected ?? NONE))}
              options={[{ value: NONE, label: "None" }, ...options.followUpTypes.map((entry) => ({ value: entry, label: FOLLOW_UP_LABELS[entry] ?? entry }))]} />
            {nextType && <DateTimeInput label="Due" isRequired value={nextDueAt} onChange={setNextDueAt} />}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={Boolean(nextType) && !nextDueAt}>Log activity</Button>
        </div>
      </div>
    </Dialog>
  );
}

// initialType: "task" opens it as Add task.
// ------------------------------------------------------------------ history

// The stage path, the ownership changes and the audit trail. Entries are never edited or removed.
export function OpportunityHistoryPanel({ opportunity }: { opportunity: Opportunity }) {
  const version = opportunity.updatedAt;
  const stageKey = useKey(opportunity.id, `stage-history:${version}`);
  const assignmentKey = useKey(opportunity.id, `assignment-history:${version}`);
  const auditKey = useKey(opportunity.id, `history:${version}`);
  const stages = useQuery({ queryKey: stageKey, queryFn: () => listOpportunityStageHistory(opportunity.id) });
  const assignments = useQuery({ queryKey: assignmentKey, queryFn: () => listOpportunityAssignmentHistory(opportunity.id) });
  const audit = useQuery({ queryKey: auditKey, queryFn: () => listOpportunityHistory(opportunity.id) });
  const list = "flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm";
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Stage history</h3>
        {stages.isLoading ? <LoadingState label="Loading stage history" rows={2} /> : (
          <ul className={list}>
            {(stages.data ?? []).map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
                <span className="font-medium">
                  {entry.toStageName}{entry.fromStageName ? <span className="font-normal text-text-secondary"> from {entry.fromStageName}</span> : null}
                  <span className="font-normal text-text-secondary"> · {entry.probabilityBefore !== null && entry.probabilityBefore !== entry.probability ? `${entry.probabilityBefore}% → ` : ""}{entry.probability}%</span>
                  {!entry.leftAt && <span className="font-normal text-text-secondary"> · current</span>}
                </span>
                {(entry.outcomeReason || entry.note) && <span className="text-text-secondary">{[entry.outcomeReason, entry.note].filter(Boolean).join(" — ")}</span>}
                <span className="text-xs text-text-muted">Entered {formatDateTime(entry.enteredAt)}{entry.leftAt ? ` · left ${formatDateTime(entry.leftAt)}` : ""} · {entry.changedByName ?? "System"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Ownership history</h3>
        {assignments.isLoading ? <LoadingState label="Loading ownership history" rows={2} /> : (assignments.data ?? []).length === 0 ? empty("No ownership changes.") : (
          <ul className={list}>
            {(assignments.data ?? []).map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
                <span className="font-medium">
                  {[entry.ownerChanged && `${entry.previousOwnerName ?? "Unassigned"} → ${entry.newOwnerName ?? "Unassigned"}`,
                    entry.teamChanged && `Team: ${entry.previousTeamName ?? "No team"} → ${entry.newTeamName ?? "No team"}`].filter(Boolean).join(" · ")}
                </span>
                {entry.reason && <span className="text-text-secondary">{entry.reason}</span>}
                <span className="text-xs text-text-muted">{formatDateTime(entry.assignedAt)} · {entry.assignedByName ?? "System"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Audit trail</h3>
        {audit.isLoading ? <LoadingState label="Loading audit trail" rows={3} /> : (
          <ul className={list}>
            {(audit.data ?? []).map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
                <span className="font-medium">{entry.summary}</span>
                {typeof entry.changes.reason === "string" && entry.changes.reason && <span className="text-text-secondary">{entry.changes.reason}</span>}
                <span className="text-xs text-text-muted">{formatDateTime(entry.createdAt)} · {entry.actorName ?? "System"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
