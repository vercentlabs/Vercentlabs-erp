"use client";

// Prospect -> customer. "Create customer" turns this account into the
// Customer Master Sales and Finance transact with; "Link existing customer"
// merges it into a customer that was already created in Sales.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, ComboBox, Dialog, Select, TextField } from "@vercentlabs/design-system";

import { CurrencySelect } from "@/features/crm/shared/ui/CurrencySelect";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createCustomer, errorMessage, getCustomerReadiness, linkCustomer, searchLinkableCustomers, type Account, type AccountOptions } from "../api/accounts-api";
import { ErrorBanner } from "../account-format";

const NONE = "";

export function CreateCustomerDialog({ account, options, isOpen, onOpenChange, onDone }: {
  account: Account; options: AccountOptions; isOpen: boolean; onOpenChange: (open: boolean) => void; onDone: () => void;
}) {
  const workspace = useWorkspaceContext();
  const readiness = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account", account.id, "customer-readiness"), queryFn: () => getCustomerReadiness(account.id), enabled: isOpen });
  const [values, setValues] = useState({ gstin: "", pan: "", paymentTermId: NONE, creditLimit: "", currencyCode: account.currencyCode ?? options.baseCurrency });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof values>(key: K) => (value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };
  const mutation = useMutation({
    mutationFn: () => createCustomer(account.id, { ...values, paymentTermId: values.paymentTermId || undefined, creditLimit: values.creditLimit.replace(/[,\s]/g, "") || undefined }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => {
      const issues = (failure as { details?: { issues?: Array<{ field: string; message: string }> } }).details?.issues ?? [];
      setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.field, issue.message])));
      setError(errorMessage(failure));
    },
  });
  const ready = readiness.data?.ready;

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Create customer"
      description="Makes this account a customer that Sales can quote and invoice. It keeps its contacts, opportunities and history, and gets a customer number." size="lg">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        {readiness.isLoading ? <LoadingState label="Checking the account" rows={2} /> : readiness.data && !ready ? (
          <div role="alert" className="rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-3 py-2 text-sm">
            <p className="font-medium">Before this account can become a customer:</p>
            <ul className="list-disc pl-5">{readiness.data.missing.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-secondary">Commercial terms are optional here and are maintained by Sales afterwards.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="GSTIN" value={values.gstin} onChange={(value) => set("gstin")(value.toUpperCase())} errorMessage={fieldErrors.gstin} placeholder="27ABCDE1234F1Z5" />
              <TextField label="PAN" description="Filled from the GSTIN when left empty." value={values.pan} onChange={(value) => set("pan")(value.toUpperCase())} errorMessage={fieldErrors.pan} />
              <Select label="Payment terms" selectedKey={values.paymentTermId} onSelectionChange={(key) => set("paymentTermId")(String(key ?? NONE))}
                options={[{ value: NONE, label: "Not set" }, ...options.paymentTerms.map((term) => ({ value: term.id, label: term.name }))]} />
              <TextField label="Credit limit" inputMode="decimal" value={values.creditLimit} onChange={set("creditLimit")} errorMessage={fieldErrors.creditLimit} />
              <CurrencySelect value={values.currencyCode} onChange={set("currencyCode")} />
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!ready}>Create customer</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function LinkCustomerDialog({ account, isOpen, onOpenChange, onLinked }: {
  account: Account; isOpen: boolean; onOpenChange: (open: boolean) => void; onLinked: (customerId: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account", account.id, "linkable-customers", text),
    queryFn: () => searchLinkableCustomers(account.id, text),
    enabled: isOpen,
    staleTime: 10_000,
  });
  const mutation = useMutation({
    mutationFn: () => linkCustomer(account.id, customerId as string),
    onSuccess: (link) => { setError(null); onOpenChange(false); onLinked(link.keptAccountId); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const rows = query.data ?? [];
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Link existing customer"
      description="For a company that already exists as a customer in Sales. This account is merged into that customer: its contacts, opportunities, activities and history move across, and this account is archived.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <ComboBox label="Customer" placeholder="Search by name, customer number or GSTIN"
          options={rows.map((row) => ({ value: row.id, label: `${row.name} (${row.customerNumber ?? row.code})` }))}
          selectedKey={customerId} onSelectionChange={(key) => setCustomerId(key ? String(key) : null)} onInputChange={setText} isLoading={query.isFetching}
          emptyMessage="No matching customers" allowsEmptyCollection />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!customerId}>Link and merge</Button>
        </div>
      </div>
    </Dialog>
  );
}
