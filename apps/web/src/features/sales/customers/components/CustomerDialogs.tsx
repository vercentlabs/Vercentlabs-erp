"use client";

// Status changes, linking a CRM account, and the quick-create dialog used
// from a quotation.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, ComboBox, Dialog, TextArea } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  changeCustomerStatus, errorMessage, getCustomerOptions, linkCustomerToAccount, searchAccountsForCustomer, type Customer,
} from "../api/customers-api";
import { ErrorBanner } from "../customer-format";
import { CustomerForm } from "./CustomerForm";

export type StatusAction = "activate" | "deactivate" | "block" | "unblock";

const STATUS_COPY: Record<StatusAction, { title: string; description: string; confirm: string; reasonRequired: boolean; reasonLabel: string }> = {
  block: {
    title: "Block customer", confirm: "Block customer", reasonRequired: true, reasonLabel: "Reason",
    description: "No new quotation or sales order can be created for a blocked customer. Existing documents are not changed.",
  },
  unblock: { title: "Unblock customer", confirm: "Unblock customer", reasonRequired: false, reasonLabel: "Note (optional)", description: "New quotations and sales orders can be created again." },
  deactivate: {
    title: "Inactivate customer", confirm: "Inactivate", reasonRequired: false, reasonLabel: "Reason (optional)",
    description: "An inactive customer cannot be chosen on new documents. It stays on its existing documents and reports, and can be reactivated.",
  },
  activate: { title: "Reactivate customer", confirm: "Reactivate", reasonRequired: false, reasonLabel: "Note (optional)", description: "The customer can be chosen on new documents again." },
};

export function CustomerStatusDialog({ customer, action, onClose, onDone }: { customer: Customer; action: StatusAction; onClose: () => void; onDone: () => void }) {
  const copy = STATUS_COPY[action];
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => changeCustomerStatus(customer.id, action, reason.trim() || undefined),
    onSuccess: onDone,
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={copy.title} description={`${customer.displayName} (${customer.customerNumber}). ${copy.description}`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextArea label={copy.reasonLabel} isRequired={copy.reasonRequired} rows={3} value={reason} onChange={setReason}
          description={copy.reasonRequired ? "Shown to anyone who tries to quote or sell to this customer." : undefined} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant={action === "block" || action === "deactivate" ? "danger" : "primary"} isLoading={mutation.isPending}
            isDisabled={copy.reasonRequired && reason.trim().length < 5} onPress={() => mutation.mutate()}>{copy.confirm}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// Links a CRM account that is not a customer yet: it is merged into this
// customer, which keeps its number and documents.
export function LinkAccountDialog({ customer, onClose, onDone }: { customer: Customer; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer-accounts", search), queryFn: () => searchAccountsForCustomer(search) });
  const mutation = useMutation({
    mutationFn: () => linkCustomerToAccount(customer.id, accountId!),
    onSuccess: onDone,
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Link CRM account"
      description={`The CRM account you choose is merged into ${customer.displayName}. The customer keeps its number and documents and gains the account's contacts, opportunities and history. This cannot be undone.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <ComboBox label="CRM account" isRequired placeholder="Search accounts that are not customers yet" selectedKey={accountId} onSelectionChange={(value) => setAccountId(value ? String(value) : null)}
          onInputChange={setSearch} isLoading={accounts.isFetching} emptyMessage="No matching accounts"
          options={(accounts.data ?? []).filter((entry) => entry.id !== customer.id).map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.accountNumber})` }))} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={mutation.isPending} isDisabled={!accountId} onPress={() => mutation.mutate()}>Link account</Button>
        </div>
      </div>
    </Dialog>
  );
}

// The compact customer form, for creating a customer without leaving a
// quotation: the fields a quotation needs, and nothing else.
export function CustomerQuickCreateDialog({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (customer: Customer) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer-options"), queryFn: getCustomerOptions, enabled: isOpen, staleTime: 60_000 });
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} title="New customer" description="The essentials for a quotation. The rest can be completed on the customer later." size="lg">
      <div className="overflow-y-auto pr-1">
        {options.isLoading ? <LoadingState label="Loading" rows={3} />
          : options.isError || !options.data ? <ErrorBanner message={errorMessage(options.error, "The form could not be loaded.")} />
          : <CustomerForm options={options.data} compact origin="quotation" onSaved={onCreated} onCancel={onClose} />}
      </div>
    </Dialog>
  );
}
