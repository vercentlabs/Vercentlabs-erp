"use client";

// The project's Customer & Contacts tab: the customer as Sales and CRM hold it (read-only here), the customer's people on the project with their
// project roles, the sites where the work happens, the customer's sales and CRM records behind it, and the association history. A draft chooses
// its customer directly; past the draft the customer changes through a reviewed request (and, where required, someone else's approval).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ComboBox, Dialog, LinkButton, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import {
  CONTACT_ROLE_LABEL, addProjectContact, addProjectSite, assignCustomer, customerAction, decideCustomerChange, eligibleContacts, errorCode, errorDetails, errorMessage, errorStatus,
  getCustomerHistory, getProjectContacts, getProjectCustomer, getProjectSites, newKey, previewCustomerChange, removeProjectContact, removeProjectSite, replaceProjectContact,
  searchCustomers, updateProjectContact, updateProjectSite, type ChangeReview, type ContactRole, type EligibleCustomer, type Project, type ProjectContact, type ProjectCustomer, type ProjectSite,
} from "../api/projects-api";

const ROLE_OPTIONS = (Object.keys(CONTACT_ROLE_LABEL) as ContactRole[]).map((value) => ({ value, label: CONTACT_ROLE_LABEL[value] }));
const LINK_LABEL: Record<string, string> = { CRM_ACCOUNT: "CRM account", CRM_CONTACT: "Contact", CRM_OPPORTUNITY: "Opportunity", SALES_QUOTATION: "Quotation", SALES_ORDER: "Sales order",
  SALES_INVOICE: "Invoice" };
const ADDRESS_LABEL: Record<string, string> = { registered: "Registered", billing: "Billing", shipping: "Shipping", office: "Office", plant: "Plant", other: "Other" };
const addressLine = (row: { line1: string; line2: string | null; city: string; state: string | null; postalCode: string | null }) =>
  [row.line1, row.line2, row.city, row.state, row.postalCode].filter(Boolean).join(", ");

type Changed = (text: string, tone?: "success" | "warning") => Promise<void>;

export function CustomerTab({ project, onChanged, onTab }: { project: Project; onChanged: Changed; onTab: (tab: string) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "customer", project.id), queryFn: () => getProjectCustomer(project.id), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [dialog, setDialog] = useState<"assign" | "change" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (query.isLoading) return <LoadingState label="Loading the customer" rows={5} />;
  if (query.isError || !query.data) {
    return <Notice tone={errorStatus(query.error) === 403 ? "neutral" : "danger"}>{errorStatus(query.error) === 403
      ? "You may see this project but not its customer details. Ask an administrator for the View project customers permission." : errorMessage(query.error)}</Notice>;
  }
  const data = query.data;
  const can = data.can;
  const done = async (text: string, tone: "success" | "warning" = "success") => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); await onChanged(text, tone); };
  const run = async (work: () => Promise<unknown>, text: string) => {
    setError(null);
    try { await work(); await done(text); } catch (failure) { setError(errorMessage(failure)); }
  };
  const request = data.changeRequest;
  return (
    <div className="flex flex-col gap-4">
      {error && <Notice tone="danger">{error}</Notice>}
      {data.review && (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{`Review needed: ${data.review.reason}`}</span>
            {can.review && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Mark as reviewed", confirm: "Mark reviewed", description: "Say what you checked; the note is kept in the history.",
              fields: [{ name: "note", label: "What was reviewed", kind: "textarea", required: true }], run: (values) => run(() => customerAction(project.id, "clear-review", { note: values.note }), "Marked as reviewed.") })}>Mark reviewed</Button>}
          </span>
        </Notice>
      )}
      {request && (
        <Notice tone="info">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{`Customer change to ${request.toCustomer} waiting for approval${request.requestedBy ? ` — asked by ${request.requestedBy}` : ""}: ${request.reason}`}</span>
            <span className="flex gap-2">
              {can.approveRequest && <Button size="compact" variant="primary" onPress={() => setAsk({ title: `Change the customer to ${request.toCustomer}`, confirm: "Approve", description: reviewText(request.review),
                fields: [{ name: "note", label: "Note", kind: "textarea" }], run: (values) => run(() => decideCustomerChange(project.id, request.id, { action: "decide", decision: "APPROVE", note: String(values.note ?? "") || undefined }), `The customer is now ${request.toCustomer}.`) })}>Approve</Button>}
              {can.approveRequest && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Reject the customer change", confirm: "Reject", tone: "danger",
                fields: [{ name: "note", label: "Why", kind: "textarea", required: true }], run: (values) => run(() => decideCustomerChange(project.id, request.id, { action: "decide", decision: "REJECT", note: String(values.note) }), "Customer change rejected.") })}>Reject</Button>}
              {can.withdrawRequest && <Button size="compact" variant="ghost" onPress={() => run(() => decideCustomerChange(project.id, request.id, { action: "withdraw" }), "Request withdrawn.")}>Withdraw</Button>}
            </span>
          </span>
        </Notice>
      )}
      <CustomerPanel data={data} onAssign={() => setDialog("assign")} onChange={() => setDialog("change")}
        onResolve={() => run(() => customerAction(project.id, "resolve-mapping", { expectedVersion: data.version }), "The project now has its Customer record.")} />
      <ContactsPanel project={project} data={data} onDone={done} />
      <SitesPanel project={project} data={data} onDone={done} />
      <Panel title="Related sales and CRM records" description="The customer's opportunities, quotations, orders and invoices behind this project. They stay in their own modules; amounts only for those who may see project financials."
        actions={<Button size="compact" variant="ghost" onPress={() => onTab("related")}>Open related records</Button>}>
        {data.salesLinks.length ? <FactList columns={3} items={data.salesLinks.map((row) => [LINK_LABEL[row.type] ?? row.type, String(row.count)] as [string, string])} />
          : <p className="text-sm text-text-muted">No sales or CRM records linked yet.</p>}
      </Panel>
      {can.history && <HistoryPanel project={project} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "assign" && <AssignDialog project={project} data={data} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "change" && <ChangeDialog project={project} data={data} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

const reviewText = (review: ChangeReview) => [...review.blocking.map((row) => `Blocked: ${row.message}`), ...review.warnings.map((row) => row.message)].join(" ") || "Nothing linked depends on the current customer.";

function CustomerPanel({ data, onAssign, onChange, onResolve }: { data: ProjectCustomer; onAssign: () => void; onChange: () => void; onResolve: () => void }) {
  const customer = data.customer;
  const can = data.can;
  const actions = can.assign ? <Button size="compact" variant="secondary" onPress={onAssign}>{customer || data.provisional ? "Choose another customer" : "Choose the customer"}</Button>
    : can.change && customer && !data.changeRequest ? <Button size="compact" variant="secondary" onPress={onChange}>Change customer</Button> : undefined;
  if (data.provisional) {
    const ready = data.provisional.nowCustomer || data.provisional.mergedInto;
    return (
      <Panel title="Customer" actions={actions}>
        <Notice tone="info">{`${data.provisional.name} is a CRM account, not yet a Customer. The draft keeps it as a provisional customer; it is linked to a Customer record before the project is activated.`}</Notice>
        {ready && can.resolveMapping && <div><Button variant="primary" onPress={onResolve}>{data.provisional.mergedInto ? `Use ${data.provisional.mergedInto.name}` : `Use the Customer record of ${data.provisional.name}`}</Button></div>}
        {!ready && <p className="text-sm text-text-muted">Create the Customer from the CRM account (or link it to an existing Customer) in CRM, then come back here.</p>}
        <LinkButton size="compact" variant="ghost" href={`/crm/accounts/${data.provisional.id}`}>Open the CRM account</LinkButton>
      </Panel>
    );
  }
  if (!customer) {
    return (
      <Panel title="Customer" actions={actions}>
        <p className="text-sm text-text-muted">{data.classification === "INTERNAL" ? "An internal project has no customer." : "No customer yet. A customer project needs one before it is activated."}</p>
      </Panel>
    );
  }
  return (
    <Panel title="Customer" description="As Sales and CRM hold it. Change the customer's own details there; the project only refers to it." actions={actions}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{customer.name}</span>
        {customer.number && <span className="text-sm text-text-muted">{customer.number}</span>}
        {customer.inactive && <StatusBadge tone="warning">Inactive customer</StatusBadge>}
        {customer.salesBlocked && <StatusBadge tone="danger">Sales blocked</StatusBadge>}
      </div>
      {customer.merged && <Notice tone="warning">{`This customer was merged into ${customer.merged.name}. Review the project's customer.`}</Notice>}
      {customer.inactive && <Notice tone="neutral">The customer is inactive. Work on this project continues; new sales and billing documents need review in Sales first.</Notice>}
      <FactList columns={3} items={[
        ["Legal name", customer.legalName ?? "—"], ["Phone", customer.phone ?? "—"], ["Email", customer.email ?? "—"],
        ["GSTIN", customer.tax.gstin ?? "Not registered"], ["GST state", customer.tax.state ? `${customer.tax.state} (${customer.tax.stateCode})` : "—"],
        ["Customer projects", customer.projects ? `${customer.projects.total} (${customer.projects.active} open)` : "—"],
      ]} />
      <p className="text-xs text-text-muted">Tax identity is read from the customer master. Each invoice&apos;s place of supply is decided by Sales and Tax, never by a project site.</p>
      {customer.addresses.length > 0 && (
        <LinesTable columns={["Address", "Use", "GSTIN"]}>
          {customer.addresses.map((row) => (
            <tr key={row.id}>
              <Cell>{addressLine(row)}</Cell>
              <Cell>{[ADDRESS_LABEL[row.type] ?? row.type, row.defaultBilling ? "default billing" : null, row.defaultShipping ? "default shipping" : null].filter(Boolean).join(" · ")}</Cell>
              <Cell>{row.gstin ?? "—"}</Cell>
            </tr>
          ))}
        </LinesTable>
      )}
      <div className="flex gap-2">
        <LinkButton size="compact" variant="ghost" href={`/sales/customers/${customer.id}`}>Open the customer</LinkButton>
        <LinkButton size="compact" variant="ghost" href={`/crm/accounts/${customer.id}`}>Open in CRM</LinkButton>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ choosing a customer
function CustomerPicker({ value, onChange, crmAccounts }: { value: EligibleCustomer | null; onChange: (row: EligibleCustomer | null) => void; crmAccounts: boolean }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState(value?.name ?? "");
  const term = useDebouncedValue(search);
  const customers = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "customers", term, crmAccounts), queryFn: () => searchCustomers(term, crmAccounts), staleTime: 30_000 });
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <ComboBox label="Customer" placeholder="Search by name, number, phone or GSTIN" selectedKey={value?.id ?? null} inputValue={search} onInputChange={setSearch}
        onSelectionChange={(key) => {
          const row = (customers.data ?? []).find((item) => item.id === key) ?? null;
          if (row && !row.selectable) { setProblem(row.inactive ? "This customer is inactive. Choose an eligible customer." : "This record cannot be chosen."); return; }
          setProblem(null); onChange(row);
        }}
        options={(customers.data ?? []).map((row) => ({ value: row.id, label: [row.name, row.number, row.city, row.note].filter(Boolean).join(" · ") }))}
        isLoading={customers.isFetching} emptyMessage="No customer matches. A new customer is created in Sales or CRM first." errorMessage={problem ?? undefined} />
      {value?.similarNames && <Notice tone="warning">Customers with similar names exist. Check the number and city.</Notice>}
      {errorStatus(customers.error) === 403 && <Notice tone="neutral">You may not search customers.</Notice>}
    </div>
  );
}

function AssignDialog({ project, data, onClose, onDone }: { project: Project; data: ProjectCustomer; onClose: () => void; onDone: Changed }) {
  const [chosen, setChosen] = useState<EligibleCustomer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="Choose the customer" size="md">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">From the shared customer master. Contacts of another customer leave the project; linked sales records must belong to the new customer.</p>
        <CustomerPicker value={chosen} onChange={setChosen} crmAccounts />
        {chosen?.kind === "CRM_ACCOUNT" && <Notice tone="info">A CRM account, not yet a Customer: the draft keeps it as a provisional customer until it is linked to a Customer record.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!chosen || busy} onPress={async () => {
            setBusy(true); setError(null);
            try {
              await assignCustomer(project.id, { ...(chosen!.kind === "CRM_ACCOUNT" ? { crmAccountId: chosen!.id } : { customerId: chosen!.id }), expectedVersion: data.version, idempotencyKey: key });
              await onDone(`${chosen!.name} is the customer.`); onClose();
            } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
          }}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ChangeDialog({ project, data, onClose, onDone }: { project: Project; data: ProjectCustomer; onClose: () => void; onDone: Changed }) {
  const [chosen, setChosen] = useState<EligibleCustomer | null>(null);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [correction, setCorrection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const workspace = useWorkspaceContext();
  const preview = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "customer-change", project.id, chosen?.id), queryFn: () => previewCustomerChange(project.id, chosen!.id), enabled: Boolean(chosen), retry: false });
  const review = preview.data;
  const blocked = Boolean(review?.blocking.length);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Change the customer of ${project.code}`} size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">{`${data.customer?.name ?? "The customer"} is the customer now. Invoices and posted documents are never changed by a project; the change is reviewed first${data.changeApprovalRequired || project.status !== "PLANNED" ? " and approved by someone else" : ""}.`}</p>
        <CustomerPicker value={chosen} onChange={(row) => { setChosen(row); setAcknowledged(false); }} crmAccounts={false} />
        {preview.isFetching && <LoadingState label="Reviewing what the change touches" rows={2} />}
        {preview.isError && <Notice tone="danger">{errorMessage(preview.error)}</Notice>}
        {review && (
          <div className="flex flex-col gap-2">
            {review.blocking.map((row) => <Notice key={row.code + row.message} tone="danger">{row.message}</Notice>)}
            {review.warnings.map((row) => <Notice key={row.code + row.message} tone="warning">{row.message}</Notice>)}
            {!review.blocking.length && !review.warnings.length && <Notice tone="success">Nothing linked depends on the current customer.</Notice>}
            {review.approvalRequired && !blocked && <Notice tone="info">The change waits for someone else&apos;s approval.</Notice>}
          </div>
        )}
        <TextArea label="Why the customer changes" value={reason} onChange={setReason} maxLength={2000} isRequired />
        {review && review.warnings.length > 0 && !blocked && <Checkbox isSelected={acknowledged} onChange={setAcknowledged}>I have reviewed what the change touches</Checkbox>}
        {project.status === "CANCELLED" && <Checkbox isSelected={correction} onChange={setCorrection}>Record this as a correction of a cancelled project</Checkbox>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!chosen || !review || blocked || reason.trim().length < 3 || (review.warnings.length > 0 && !acknowledged) || busy} onPress={async () => {
            setBusy(true); setError(null);
            try {
              const result = await customerAction(project.id, "change-request", { toCustomerId: chosen!.id, reason: reason.trim(), acknowledgeWarnings: acknowledged, correction, expectedVersion: data.version, idempotencyKey: key });
              await onDone(result.status === "PENDING" ? "The customer change waits for approval." : `The customer is now ${chosen!.name}.`); onClose();
            } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
          }}>{review?.approvalRequired ? "Request the change" : "Change the customer"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ contacts
function ContactsPanel({ project, data, onDone }: { project: Project; data: ProjectCustomer; onDone: Changed }) {
  const workspace = useWorkspaceContext();
  const [showRemoved, setShowRemoved] = useState(false);
  const removed = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "customer-contacts", project.id, "removed"), queryFn: () => getProjectContacts(project.id, true), enabled: showRemoved });
  const [adding, setAdding] = useState<{ replace?: ProjectContact } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const manage = data.can.contacts;
  const party = data.customer?.id ?? data.provisional?.id;
  const run = async (work: () => Promise<unknown>, text: string) => {
    setError(null);
    try { await work(); await onDone(text); } catch (failure) { setError(errorCode(failure) === "PROJECT_CUSTOMER_PRIMARY_DUPLICATE" ? "Only one primary contact is allowed: replace the current one." : errorMessage(failure)); }
  };
  const rows = showRemoved ? removed.data?.contacts ?? data.contacts : data.contacts;
  return (
    <Panel title="Project contacts" description="The customer's people on this project and what they do here. Their details come from CRM; a contact gets no login to the ERP."
      actions={manage && party ? <Button size="compact" variant="secondary" onPress={() => setAdding({})}>Add a contact</Button> : undefined}>
      {error && <Notice tone="danger">{error}</Notice>}
      {data.primaryContactRequired && !data.contacts.some((row) => row.primary) && <Notice tone="warning">The company asks for a primary contact before a project is activated.</Notice>}
      {!rows.length ? <p className="text-sm text-text-muted">{party ? "No contacts on the project yet." : "Choose the customer first."}</p> : (
        <LinesTable columns={["Person", "Project role", "Email and phone", "Added", ""]}>
          {rows.map((row) => (
            <tr key={row.id} className={row.active ? undefined : "opacity-60"}>
              <Cell><span className="flex flex-col"><span>{row.name}{row.primary && row.active ? " · Primary" : ""}</span>
                <span className="text-xs text-text-muted">{[row.designation, row.contactStatus !== "active" ? `${row.contactStatus} in CRM` : null, !row.relatedToCustomer ? "no longer with the customer" : null].filter(Boolean).join(" · ")}</span></span></Cell>
              <Cell>{manage && row.active ? (
                <Select aria-label={`Role of ${row.name}`} size="compact" selectedKey={row.role} options={ROLE_OPTIONS}
                  onSelectionChange={(key) => { const role = String(key) as ContactRole; if (role === row.role) return;
                    if (role === "OTHER") { setAsk({ title: `Describe ${row.name}'s role`, confirm: "Save", fields: [{ name: "title", label: "Role on the project", kind: "text", required: true }],
                      run: (values) => run(() => updateProjectContact(project.id, row.id, { role, title: values.title, expectedVersion: row.version }), "Role changed.") }); return; }
                    void run(() => updateProjectContact(project.id, row.id, { role, expectedVersion: row.version, replacePrimary: role === "PRIMARY" }), `${row.name} is now the ${CONTACT_ROLE_LABEL[role]}.`); }} />
              ) : <span>{row.roleLabel}</span>}{row.title && <span className="block text-xs text-text-muted">{row.title}</span>}</Cell>
              <Cell>{[row.email, row.phone].filter(Boolean).join(" · ") || "—"}</Cell>
              <Cell>{row.active ? `${formatDateTime(row.addedAt)}${row.addedBy ? ` · ${row.addedBy}` : ""}` : `Left ${row.removedAt ? formatDateTime(row.removedAt) : ""}${row.removalNote ? ` · ${row.removalNote}` : ""}`}</Cell>
              <Cell>{manage && row.active && (
                <span className="flex gap-1">
                  <Button size="compact" variant="ghost" onPress={() => setAdding({ replace: row })}>Replace</Button>
                  <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Remove ${row.name} from the project`, confirm: "Remove", tone: "danger",
                    description: "What they approved or said stays attributed to them.", fields: [{ name: "note", label: "Why", kind: "textarea" }],
                    run: (values) => run(() => removeProjectContact(project.id, row.id, String(values.note ?? "") || undefined), `${row.name} left the project.`) })}>Remove</Button>
                </span>
              )}</Cell>
            </tr>
          ))}
        </LinesTable>
      )}
      <Checkbox isSelected={showRemoved} onChange={setShowRemoved}>Show people who left the project</Checkbox>
      {adding && party && <ContactDialog project={project} data={data} replace={adding.replace} onClose={() => setAdding(null)} onDone={onDone} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}

function ContactDialog({ project, data, replace, onClose, onDone }: { project: Project; data: ProjectCustomer; replace?: ProjectContact; onClose: () => void; onDone: Changed }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search);
  const people = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "eligible-contacts", project.id, term), queryFn: () => eligibleContacts(project.id, term) });
  const [contactId, setContactId] = useState<string | null>(null);
  const [role, setRole] = useState<ContactRole>(data.contacts.some((row) => row.primary) ? "TECHNICAL" : "PRIMARY");
  const [title, setTitle] = useState("");
  const [replacePrimary, setReplacePrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPrimary = data.contacts.some((row) => row.primary);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={replace ? `Replace ${replace.name}` : "Add a contact"} size="md">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">{`${data.customer?.name ?? data.provisional?.name}'s active contacts are offered. A new person is added in CRM first.`}</p>
        <ComboBox label="Person" placeholder="Search by name or email" selectedKey={contactId} inputValue={search} onInputChange={setSearch} onSelectionChange={(key) => setContactId(key ? String(key) : null)}
          options={(people.data ?? []).filter((row) => row.id !== replace?.contactId).map((row) => ({ value: row.id, label: [row.name, row.designation, row.email].filter(Boolean).join(" · ") }))}
          isLoading={people.isFetching} emptyMessage="No active contact of the customer matches." />
        {!replace && <Select label="Role on the project" selectedKey={role} onSelectionChange={(key) => setRole(String(key) as ContactRole)} options={ROLE_OPTIONS} />}
        {!replace && <TextField label={role === "OTHER" ? "Describe the role" : "Title on the project"} value={title} onChange={setTitle} maxLength={120} isRequired={role === "OTHER"}
          description="For example: Project Coordinator" />}
        {!replace && role === "PRIMARY" && hasPrimary && <Checkbox isSelected={replacePrimary} onChange={setReplacePrimary}>Replace the current primary contact</Checkbox>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!contactId || busy || (!replace && role === "OTHER" && title.trim().length < 2) || (!replace && role === "PRIMARY" && hasPrimary && !replacePrimary)} onPress={async () => {
            setBusy(true); setError(null);
            try {
              if (replace) await replaceProjectContact(project.id, replace.id, { contactId: contactId! });
              else await addProjectContact(project.id, { contactId: contactId!, role, title: title.trim() || undefined, replacePrimary });
              await onDone(replace ? "Contact replaced." : "Contact added."); onClose();
            } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
          }}>{replace ? "Replace" : "Add"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ sites
function SitesPanel({ project, data, onDone }: { project: Project; data: ProjectCustomer; onDone: Changed }) {
  const workspace = useWorkspaceContext();
  const [showRemoved, setShowRemoved] = useState(false);
  const removed = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "customer-sites", project.id, "removed"), queryFn: () => getProjectSites(project.id, true), enabled: showRemoved });
  const [editing, setEditing] = useState<{ site?: ProjectSite } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const manage = data.can.sites;
  const rows = showRemoved ? removed.data?.sites ?? data.sites : data.sites;
  return (
    <Panel title="Project sites" description="Where the work happens — separate from the customer's billing address. A site keeps the address it was given; a later change to the customer's address does not rewrite it."
      actions={manage ? <Button size="compact" variant="secondary" onPress={() => setEditing({})}>Add a site</Button> : undefined}>
      {error && <Notice tone="danger">{error}</Notice>}
      {!rows.length ? <p className="text-sm text-text-muted">No site yet.</p> : (
        <LinesTable columns={["Site", "Address", ""]}>
          {rows.map((row) => (
            <tr key={row.id} className={row.active ? undefined : "opacity-60"}>
              <Cell><span className="flex flex-col"><span>{row.name}{row.primary ? " · Primary" : ""}</span><span className="text-xs text-text-muted">{row.sourceAddressId ? "From the customer's addresses" : "Entered for the project"}{row.active ? "" : " · removed"}</span></span></Cell>
              <Cell>{addressLine(row)}</Cell>
              <Cell>{manage && row.active && (
                <span className="flex gap-1">
                  {!row.primary && <Button size="compact" variant="ghost" onPress={async () => { setError(null); try { await updateProjectSite(project.id, row.id, { isPrimary: true, expectedVersion: row.version }); await onDone(`${row.name} is the primary site.`); } catch (failure) { setError(errorMessage(failure)); } }}>Make primary</Button>}
                  <Button size="compact" variant="ghost" onPress={() => setEditing({ site: row })}>Edit</Button>
                  <Button size="compact" variant="ghost" onPress={async () => { setError(null); try { await removeProjectSite(project.id, row.id); await onDone(`${row.name} removed.`); } catch (failure) { setError(errorMessage(failure)); } }}>Remove</Button>
                </span>
              )}</Cell>
            </tr>
          ))}
        </LinesTable>
      )}
      <Checkbox isSelected={showRemoved} onChange={setShowRemoved}>Show removed sites</Checkbox>
      {editing && <SiteDialog project={project} data={data} site={editing.site} onClose={() => setEditing(null)} onDone={onDone} />}
    </Panel>
  );
}

function SiteDialog({ project, data, site, onClose, onDone }: { project: Project; data: ProjectCustomer; site?: ProjectSite; onClose: () => void; onDone: Changed }) {
  const addresses = data.customer?.addresses ?? [];
  const [source, setSource] = useState<string>(site ? "typed" : addresses[0]?.id ?? "typed");
  const [form, setForm] = useState({ siteName: site?.name ?? "", line1: site?.line1 ?? "", line2: site?.line2 ?? "", city: site?.city ?? "", stateCode: site?.stateCode ?? "", postalCode: site?.postalCode ?? "",
    countryCode: site?.countryCode ?? "IN", isPrimary: site?.primary ?? data.sites.length === 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const typed = source === "typed";
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={site ? `Edit ${site.name}` : "Add a site"} size="md">
      <div className="flex flex-col gap-3">
        <TextField label="Site name" value={form.siteName} onChange={set("siteName")} maxLength={120} isRequired description="For example: Bengaluru office, Pune plant" errorMessage={fieldErrors.siteName} />
        {!site && <Select label="Address" selectedKey={source} onSelectionChange={(key) => setSource(String(key))}
          options={[...addresses.map((row) => ({ value: row.id, label: `${ADDRESS_LABEL[row.type] ?? row.type}: ${addressLine(row)}` })), { value: "typed", label: "Enter an address for this project" }]} />}
        {typed && (
          <>
            <TextField label="Address" value={form.line1} onChange={set("line1")} maxLength={200} isRequired errorMessage={fieldErrors.line1} />
            <TextField label="Address line 2" value={form.line2} onChange={set("line2")} maxLength={200} />
            <TextField label="City" value={form.city} onChange={set("city")} maxLength={80} isRequired errorMessage={fieldErrors.city} />
            {form.countryCode === "IN" && <Select label="State" placeholder="Choose" selectedKey={form.stateCode || null} onSelectionChange={(key) => set("stateCode")(key ? String(key) : "")}
              options={data.gstStates.map((row) => ({ value: row.code, label: row.name }))} errorMessage={fieldErrors.stateCode} />}
            <TextField label="PIN code" value={form.postalCode} onChange={set("postalCode")} maxLength={12} inputMode="numeric" errorMessage={fieldErrors.postalCode} />
          </>
        )}
        <Checkbox isSelected={form.isPrimary} onChange={set("isPrimary")}>The primary site</Checkbox>
        <p className="text-xs text-text-muted">A site never changes an invoice&apos;s place of supply; Sales and Tax decide that.</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || form.siteName.trim().length < 2} onPress={async () => {
            setBusy(true); setError(null); setFieldErrors({});
            const body: Record<string, unknown> = typed ? { siteName: form.siteName.trim(), line1: form.line1.trim(), line2: form.line2.trim() || null, city: form.city.trim(),
              stateCode: form.stateCode || null, postalCode: form.postalCode.trim() || null, countryCode: form.countryCode, isPrimary: form.isPrimary }
              : { siteName: form.siteName.trim(), sourceAddressId: source, isPrimary: form.isPrimary };
            try {
              if (site) await updateProjectSite(project.id, site.id, { ...body, expectedVersion: site.version });
              else await addProjectSite(project.id, body);
              await onDone(site ? "Site updated." : "Site added."); onClose();
            } catch (failure) {
              const field = (errorDetails(failure) as { field?: string }).field;
              if (field) setFieldErrors({ [field]: errorMessage(failure) });
              setError(errorMessage(failure)); setBusy(false);
            }
          }}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

function HistoryPanel({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "customer-history", project.id), queryFn: () => getCustomerHistory(project.id) });
  return (
    <Panel title="Customer history" description="Every change to the project's customer, contacts, sites and sales links. It is never rewritten.">
      {history.isLoading ? <LoadingState label="Loading the history" rows={3} /> : (
        <HistoryList title={null} entries={(history.data ?? []).map((row) => ({ summary: row.reason ? `${row.summary} — ${row.reason}` : row.summary, at: row.at, actor: row.actor }))} />
      )}
    </Panel>
  );
}
