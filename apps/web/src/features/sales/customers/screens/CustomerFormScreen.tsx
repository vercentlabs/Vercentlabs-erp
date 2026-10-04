"use client";

// New customer (directly, or from a CRM account) and Edit customer.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ComboBox, ErrorState, LinkButton, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, errorMessage, getAccountPrefill, getCustomer, getCustomerOptions, searchAccountsForCustomer, type Customer } from "../api/customers-api";
import { ErrorBanner } from "../customer-format";
import { CustomerForm } from "../components/CustomerForm";

const card = "rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-6";

export function CustomerFormScreen({ customerId, accountId }: { customerId?: string; accountId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const editing = Boolean(customerId);
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer-options"), queryFn: getCustomerOptions, staleTime: 60_000 });
  const customerQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer", customerId), queryFn: () => getCustomer(customerId!), enabled: editing });
  const prefillQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer-prefill", accountId), queryFn: () => getAccountPrefill(accountId!), enabled: Boolean(accountId) && !editing });
  const options = optionsQuery.data;
  const canLink = Boolean(options?.capabilities.linkAccount);
  const accountsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "customer-accounts", search), queryFn: () => searchAccountsForCustomer(search), enabled: picking && canLink && !editing && !accountId,
  });

  const saved = (customer: Customer) => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customers") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customer", customer.id) });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "options") });
    router.push(`/sales/customers/${customer.id}`);
  };
  const back = () => router.push(customerId ? `/sales/customers/${customerId}` : "/sales/customers");

  if (optionsQuery.isLoading || (editing && customerQuery.isLoading) || (accountId && prefillQuery.isLoading)) return <LoadingState label="Loading" rows={6} />;
  if (optionsQuery.isError && errorCode(optionsQuery.error) === "PERMISSION_DENIED")
    return <PermissionState title="You don't have access to customers" description="Ask an administrator for the View customers permission." />;
  if (!options) return <ErrorState title="Could not load the form" action={{ label: "Try again", onPress: () => void optionsQuery.refetch() }} />;
  if (editing ? !options.capabilities.edit : !options.capabilities.create)
    return <PermissionState title={editing ? "You cannot edit customers" : "You cannot create customers"} description="Ask an administrator for access." />;
  if (editing && (customerQuery.isError || !customerQuery.data))
    return <ErrorState title="Customer not found" action={{ label: "Back to customers", onPress: () => router.push("/sales/customers") }} />;
  if (accountId && !editing && (prefillQuery.isError || !prefillQuery.data))
    return <ErrorState title="The CRM account could not be loaded" description={errorMessage(prefillQuery.error, "It may not exist, or you may not have access to it.")} action={{ label: "Back to customers", onPress: back }} />;

  const prefill = prefillQuery.data;
  if (prefill?.existingCustomer)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="New customer" />
        <div className={`${card} flex flex-col items-start gap-3 text-sm`}>
          <p><span className="font-medium">{prefill.account.name}</span> is already customer {prefill.existingCustomer.customerNumber}. An account has one customer.</p>
          <LinkButton href={`/sales/customers/${prefill.existingCustomer.id}`} variant="primary">Open the customer</LinkButton>
        </div>
      </div>
    );

  const billing = prefill?.addresses.find((address) => address.isDefaultBilling) ?? prefill?.addresses[0] ?? null;
  const customer = customerQuery.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={editing ? `Edit ${customer?.displayName ?? "customer"}` : prefill ? `New customer from ${prefill.account.name}` : "New customer"}
        description={editing ? `${customer?.customerNumber}. Changes apply to new documents; issued documents keep their own details.`
          : prefill ? "The CRM account becomes the customer. Its contacts, opportunities and history stay with it."
          : "Name, type, country and currency are required. Everything else can be added later."}
      />
      {!editing && !prefill && canLink && (
        <div className={`${card} flex flex-col gap-3 text-sm`}>
          {picking ? (
            <div className="flex flex-col gap-2 sm:max-w-md">
              <ComboBox label="CRM account" placeholder="Search accounts that are not customers yet" selectedKey={null} onInputChange={setSearch} isLoading={accountsQuery.isFetching} emptyMessage="No matching accounts"
                onSelectionChange={(key) => { if (key) router.push(`/sales/customers/new?accountId=${String(key)}`); }}
                options={(accountsQuery.data ?? []).map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.accountNumber})` }))} />
              <ErrorBanner message={accountsQuery.isError ? errorMessage(accountsQuery.error) : null} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-text-secondary">Is this company already a CRM account? Create the customer from it so its contacts and deals stay together.</p>
              <Button variant="secondary" size="compact" onPress={() => setPicking(true)}>Create from a CRM account</Button>
            </div>
          )}
        </div>
      )}
      {prefill && (
        <div className={`${card} flex flex-col gap-1 text-sm`}>
          <p><span className="font-medium">CRM account:</span> {prefill.account.name} ({prefill.account.accountNumber}){prefill.account.ownerName ? `, owned by ${prefill.account.ownerName}` : ""}</p>
          <p className="text-text-secondary">
            {prefill.addresses.length ? `${prefill.addresses.length} ${prefill.addresses.length === 1 ? "address" : "addresses"} on the account ${prefill.addresses.length === 1 ? "is" : "are"} kept.` : "The account has no address yet; add the billing address below."}
            {prefill.primaryContact ? ` Primary contact: ${prefill.primaryContact.name}.` : ""}
          </p>
        </div>
      )}
      <div className={card}>
        <CustomerForm key={customerId ?? accountId ?? "new"} options={options} customer={customer} accountId={prefill ? accountId : undefined}
          prefill={prefill ? { ...prefill.values, countryCode: prefill.values.countryCode ?? billing?.countryCode ?? undefined } : undefined}
          origin={prefill ? "crm_account" : "sales"} onSaved={saved} onCancel={back} />
      </div>
    </div>
  );
}
