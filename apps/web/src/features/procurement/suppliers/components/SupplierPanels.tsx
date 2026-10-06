"use client";

// The sections of a supplier's 360°: its places and people, the documents it
// appears on (each opening the real document), Finance's payment details,
// files and history. Figures come from the documents; nothing is copied.
import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, StatusBadge } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { calendarDate, dateTime, money, statusLabel, statusTone } from "@/features/procurement/shared/format";

import {
  errorMessage, fileUrl, getDocuments, getHistory, listFiles, listPaymentDetails, removeFile, updateAddress, updateBankAccount, updateContact, uploadFile,
  type BankAccount, type SupplierAddress, type SupplierContact, type SupplierDetail, type SupplierDocument, type SupplierOptions,
} from "../api/suppliers-api";
import { formatAddress } from "../supplier-format";
import { AddressDialog, BankAccountDialog, ContactDialog } from "./SupplierDialogs";

const Row = ({ children, inactive }: { children: React.ReactNode; inactive?: boolean }) => (
  <li className={`flex flex-wrap items-start justify-between gap-3 py-3 ${inactive ? "opacity-60" : ""}`}>{children}</li>
);

export function AddressesAndContacts({ detail, options, onChanged }: { detail: SupplierDetail; options: SupplierOptions; onChanged: (message: string) => void }) {
  const { supplier, addresses, contacts, actions } = detail;
  const [address, setAddress] = useState<SupplierAddress | "new" | null>(null);
  const [contact, setContact] = useState<SupplierContact | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggleAddress = useMutation({
    mutationFn: (entry: SupplierAddress) => updateAddress(supplier.id, entry.id, { active: entry.status !== "active" }),
    onSuccess: (_result, entry) => onChanged(entry.status === "active" ? "The address was removed." : "The address was restored."),
    onError: (failure) => setError(errorMessage(failure)),
  });
  const toggleContact = useMutation({
    mutationFn: (entry: SupplierContact) => updateContact(supplier.id, entry.id, { active: entry.status !== "active" }),
    onSuccess: (_result, entry) => onChanged(entry.status === "active" ? "The contact was removed from this supplier." : "The contact was added back."),
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <div className="flex flex-col gap-4">
      {error && <ProcAlert>{error}</ProcAlert>}
      <ProcPanel title="Addresses" description="Registered office, billing and ordering offices, dispatch locations, branches. Documents keep a copy of the address they used."
        actions={actions.manageAddresses ? <Button size="compact" variant="secondary" onPress={() => setAddress("new")}>Add address</Button> : undefined}>
        {!addresses.length ? <p className="text-sm text-text-muted">No addresses yet.</p> : (
          <ul className="flex flex-col divide-y divide-border">
            {addresses.map((entry) => (
              <Row key={entry.id} inactive={entry.status !== "active"}>
                <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {entry.addressTypeLabel}{entry.label ? ` · ${entry.label}` : ""}
                    {entry.isPrimary && <StatusBadge tone="info">Default</StatusBadge>}
                    {entry.status !== "active" && <StatusBadge tone="neutral">Removed</StatusBadge>}
                  </span>
                  <span className="text-text-secondary">{formatAddress(entry)}</span>
                  {entry.gstin && <span className="text-xs text-text-muted">GSTIN {entry.gstin}{entry.gstRegistrationLabel ? ` · ${entry.gstRegistrationLabel}` : ""}</span>}
                </span>
                {actions.manageAddresses && (
                  <span className="flex gap-2">
                    {entry.status === "active" && <Button size="compact" variant="ghost" onPress={() => setAddress(entry)}>Edit</Button>}
                    <Button size="compact" variant="ghost" isLoading={toggleAddress.isPending && toggleAddress.variables?.id === entry.id} onPress={() => toggleAddress.mutate(entry)}>
                      {entry.status === "active" ? "Remove" : "Restore"}
                    </Button>
                  </span>
                )}
              </Row>
            ))}
          </ul>
        )}
      </ProcPanel>
      <ProcPanel title="Contacts" description="The people at this supplier and their roles here. A person is a shared contact."
        actions={actions.manageContacts ? <Button size="compact" variant="secondary" onPress={() => setContact("new")}>Add contact</Button> : undefined}>
        {!contacts.length ? <p className="text-sm text-text-muted">No contacts yet.</p> : (
          <ul className="flex flex-col divide-y divide-border">
            {contacts.map((entry) => (
              <Row key={entry.id} inactive={entry.status !== "active"}>
                <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {entry.name}
                    <StatusBadge tone="neutral">{entry.roleLabel}</StatusBadge>
                    {entry.isPrimary && <StatusBadge tone="info">Primary</StatusBadge>}
                    {entry.status !== "active" && <StatusBadge tone="neutral">Removed</StatusBadge>}
                  </span>
                  <span className="text-text-secondary">{[entry.designation, entry.email, entry.mobile ?? entry.phone].filter(Boolean).join(" · ")}</span>
                </span>
                {actions.manageContacts && (
                  <span className="flex gap-2">
                    {entry.status === "active" && <Button size="compact" variant="ghost" onPress={() => setContact(entry)}>Edit</Button>}
                    <Button size="compact" variant="ghost" isLoading={toggleContact.isPending && toggleContact.variables?.id === entry.id} onPress={() => toggleContact.mutate(entry)}>
                      {entry.status === "active" ? "Remove" : "Add back"}
                    </Button>
                  </span>
                )}
              </Row>
            ))}
          </ul>
        )}
      </ProcPanel>
      {address && <AddressDialog supplier={supplier} address={address === "new" ? null : address} options={options} onClose={() => setAddress(null)}
        onDone={(message) => { setAddress(null); onChanged(message); }} />}
      {contact && <ContactDialog supplier={supplier} contact={contact === "new" ? null : contact} options={options} onClose={() => setContact(null)}
        onDone={(message) => { setContact(null); onChanged(message); }} />}
    </div>
  );
}

const KINDS: Record<string, { title: string; description: string; empty: string }> = {
  orders: { title: "Purchase orders", description: "Every purchase order for this supplier, newest first.", empty: "No purchase orders yet." },
  receipts: { title: "Goods receipts", description: "What was received from this supplier.", empty: "No goods receipts yet." },
  returns: { title: "Purchase returns", description: "Goods sent back to this supplier.", empty: "No purchase returns." },
  bills: { title: "Supplier bills", description: "From Accounts Payable: bills, credit notes and debit notes for this supplier.", empty: "No supplier bills yet." },
  payments: { title: "Payments", description: "From Accounts Payable: payments made to this supplier.", empty: "No payments yet." },
};

export function DocumentsPanel({ supplierId, kind }: { supplierId: string; kind: keyof typeof KINDS }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier", supplierId, "documents", kind), queryFn: () => getDocuments(supplierId, kind) });
  const text = KINDS[kind];
  const link = (document: SupplierDocument) => (document.href ? <Link className="font-medium tabular-nums text-brand hover:underline" href={document.href}>{document.number}</Link>
    : <span className="font-medium tabular-nums">{document.number}</span>);
  return (
    <ProcPanel title={text.title} description={text.description}>
      {query.isLoading ? <p className="text-sm text-text-muted">Loading…</p> : query.isError ? <ProcAlert>{errorMessage(query.error)}</ProcAlert> : !query.data?.length
        ? <p className="text-sm text-text-muted">{text.empty}</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {query.data.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                {link(document)}
                <StatusBadge tone={statusTone(document.status)}>{statusLabel(document.status)}</StatusBadge>
                {document.title && <span className="text-text-secondary">{document.title}</span>}
                {document.type && document.type !== "bill" && <span className="text-text-muted">{statusLabel(document.type)}</span>}
                {document.supplierInvoiceNumber && <span className="text-text-muted">Supplier invoice {document.supplierInvoiceNumber}</span>}
                {document.orderNumber && <span className="text-text-muted">for {document.orderNumber}</span>}
                <span className="text-text-muted">{calendarDate(document.date)}</span>
                {document.total !== undefined && document.total !== null && <span className="tabular-nums">{money(document.currency, document.total)}</span>}
                {document.outstanding !== undefined && document.outstanding !== null && document.outstanding > 0.005 && (
                  <span className="tabular-nums text-text-muted">{money(document.currency, document.outstanding)} open</span>
                )}
                {document.amount !== undefined && <span className="tabular-nums">{money(document.currency, document.amount)}</span>}
              </li>
            ))}
          </ul>
        )}
    </ProcPanel>
  );
}

export function PaymentDetailsPanel({ detail, options, onChanged }: { detail: SupplierDetail; options: SupplierOptions; onChanged: (message: string) => void }) {
  const workspace = useWorkspaceContext();
  const { supplier } = detail;
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "supplier-payment-details", supplier.id), queryFn: () => listPaymentDetails(supplier.id) });
  const [editing, setEditing] = useState<BankAccount | "new" | null>(null);
  const deactivate = useMutation({
    mutationFn: (account: BankAccount) => updateBankAccount(supplier.id, account.id, { status: account.status === "active" ? "inactive" : "active" }),
    onSuccess: () => { void query.refetch(); onChanged("The bank account was changed. The change is in the supplier's history."); },
  });
  const canManage = query.data?.canManage ?? false;
  return (
    <ProcPanel title="Payment details" description="Finance's: where this supplier is paid. Only Finance may change it, and every change is recorded. Not needed for RFQs or purchase orders."
      actions={canManage ? <Button size="compact" variant="secondary" onPress={() => setEditing("new")}>Add bank account</Button> : undefined}>
      {deactivate.error && <ProcAlert>{errorMessage(deactivate.error)}</ProcAlert>}
      {query.isLoading ? <p className="text-sm text-text-muted">Loading…</p> : query.isError ? <ProcAlert>{errorMessage(query.error)}</ProcAlert> : !query.data?.accounts.length
        ? <p className="text-sm text-text-muted">No bank accounts recorded.</p> : (
          <ul className="flex flex-col divide-y divide-border">
            {query.data.accounts.map((account) => (
              <Row key={account.id} inactive={account.status !== "active"}>
                <span className="flex flex-col gap-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {account.bankName} <span className="tabular-nums">{account.accountNumber ?? account.accountNumberMasked}</span>
                    {account.isPrimary && <StatusBadge tone="info">Default</StatusBadge>}
                    {account.status !== "active" && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                  </span>
                  <span className="text-text-secondary">{[account.accountHolder, account.ifscCode && `IFSC ${account.ifscCode}`, account.swiftCode && `SWIFT ${account.swiftCode}`, account.currencyCode]
                    .filter(Boolean).join(" · ")}</span>
                  <span className="text-xs text-text-muted">Changed {dateTime(account.updatedAt)}{account.updatedByName ? ` by ${account.updatedByName}` : ""}</span>
                </span>
                {canManage && (
                  <span className="flex gap-2">
                    {account.status === "active" && <Button size="compact" variant="ghost" onPress={() => setEditing(account)}>Change</Button>}
                    <Button size="compact" variant="ghost" isLoading={deactivate.isPending && deactivate.variables?.id === account.id} onPress={() => deactivate.mutate(account)}>
                      {account.status === "active" ? "Deactivate" : "Reactivate"}
                    </Button>
                  </span>
                )}
              </Row>
            ))}
          </ul>
        )}
      {editing && <BankAccountDialog supplier={supplier} account={editing === "new" ? null : editing} options={options} onClose={() => setEditing(null)}
        onDone={(message) => { setEditing(null); void query.refetch(); onChanged(message); }} />}
    </ProcPanel>
  );
}

export function FilesPanel({ detail }: { detail: SupplierDetail }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "supplier", detail.supplier.id, "files");
  const query = useQuery({ queryKey: key, queryFn: () => listFiles(detail.supplier.id) });
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const upload = useMutation({ mutationFn: (file: File) => uploadFile(detail.supplier.id, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (fileId: string) => removeFile(detail.supplier.id, fileId), onSuccess: refresh });
  const canEdit = detail.capabilities.edit;
  return (
    <ProcPanel title="Attachments" description="Contracts, rate cards, tax and quality certificates, company profile, correspondence. Internal: never sent with a purchase order."
      actions={canEdit ? (
        <>
          <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
          <Button size="compact" variant="secondary" isLoading={upload.isPending} onPress={() => input.current?.click()}>Add file</Button>
        </>
      ) : undefined}>
      {(upload.error || remove.error) && <ProcAlert>{errorMessage(upload.error ?? remove.error)}</ProcAlert>}
      {query.isLoading ? <p className="text-sm text-text-muted">Loading…</p> : !query.data?.length ? <p className="text-sm text-text-muted">No files yet.</p> : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {query.data.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <a className="font-medium text-brand hover:underline" href={fileUrl(detail.supplier.id, file.id)}>{file.fileName}</a>
              <span className="flex items-center gap-3 text-text-muted">
                {dateTime(file.uploadedAt)}
                {canEdit && <Button size="compact" variant="ghost" isLoading={remove.isPending && remove.variables === file.id} onPress={() => remove.mutate(file.id)}>Remove</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ProcPanel>
  );
}

export function HistoryPanel({ supplierId }: { supplierId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier", supplierId, "history"), queryFn: () => getHistory(supplierId) });
  return (
    <ProcPanel title="History" description="What changed and who changed it: the supplier's business events, not every edit.">
      {query.isLoading ? <p className="text-sm text-text-muted">Loading…</p> : !query.data?.length ? <p className="text-sm text-text-muted">Nothing yet.</p> : (
        <ol className="flex flex-col divide-y divide-border text-sm">
          {query.data.map((entry) => (
            <li key={entry.id} className="grid grid-cols-1 gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <span className="whitespace-nowrap tabular-nums text-text-muted">{dateTime(entry.at)}</span>
              <span>{entry.summary}{entry.actor ? <span className="text-text-muted"> · {entry.actor}</span> : null}</span>
            </li>
          ))}
        </ol>
      )}
    </ProcPanel>
  );
}
