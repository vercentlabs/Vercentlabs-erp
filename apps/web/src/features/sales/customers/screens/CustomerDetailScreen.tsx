"use client";

// The customer page: identity and status in the header with the actions that
// start a sale, then one tab per area of the relationship.
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import {
  AlertDialog, Button, ErrorState, LinkButton, Menu, MenuItem, MenuTrigger, PermissionState, RecordDetailsPage, Tab, TabList, TabPanel, Tabs,
} from "@vercentlabs/design-system";

// Notes and files are kept by CRM on the shared account record, so the
// customer and its account show the same ones.
import { RecordAttachmentsPanel } from "@/features/crm/attachments/components/RecordAttachmentsPanel";
import { RecordNotesPanel } from "@/features/crm/notes/components/RecordNotesPanel";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { deleteCustomer, errorCode, errorMessage, getCustomer, getCustomerOptions } from "../api/customers-api";
import { CustomerStatusBadge, ErrorBanner, cityState } from "../customer-format";
import { CustomerAddressesPanel } from "../components/CustomerAddressesPanel";
import { CustomerContactsPanel } from "../components/CustomerContactsPanel";
import { CustomerStatusDialog, LinkAccountDialog, type StatusAction } from "../components/CustomerDialogs";
import { CustomerOverviewPanel } from "../components/CustomerOverviewPanel";
import { CustomerHistoryPanel, CustomerRelatedPanel, type RelatedList } from "../components/CustomerRelatedPanels";

const RELATED_TABS: Array<{ id: RelatedList; label: string; needs: "sales" | "finance" | "projects" | "support" }> = [
  { id: "quotations", label: "Quotations", needs: "sales" },
  { id: "orders", label: "Sales Orders", needs: "sales" },
  { id: "deliveries", label: "Deliveries", needs: "sales" },
  { id: "invoices", label: "Invoices", needs: "finance" },
  { id: "payments", label: "Payments", needs: "finance" },
  { id: "returns", label: "Returns & Credits", needs: "sales" },
  { id: "projects", label: "Projects", needs: "projects" },
  { id: "support", label: "Support", needs: "support" },
];

export function CustomerDetailScreen({ customerId }: { customerId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestedTab = useSearchParams().get("tab");
  const [tab, setTab] = useState(requestedTab ?? "overview");
  const [dialog, setDialog] = useState<StatusAction | "link" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const customerQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer", customerId), queryFn: () => getCustomer(customerId) });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer-options"), queryFn: getCustomerOptions, staleTime: 60_000 });
  const remove = useMutation({
    mutationFn: () => deleteCustomer(customerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customers") });
      router.push("/sales/customers");
    },
    onError: (failure) => { setDialog(null); setError(errorMessage(failure)); },
  });

  if (customerQuery.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading customer" rows={6} />;
  if (customerQuery.isError || !customerQuery.data) {
    if (errorCode(customerQuery.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to customers" description="Ask an administrator for the View customers permission." />;
    return <ErrorState title="Customer not found" description="It may have been deleted, or you may not have access to it." action={{ label: "Back to customers", onPress: () => router.push("/sales/customers") }} />;
  }
  if (!optionsQuery.data) return <ErrorState title="Could not load the customer" action={{ label: "Try again", onPress: () => void optionsQuery.refetch() }} />;

  const customer = customerQuery.data;
  const options = optionsQuery.data;
  const can = options.capabilities;
  const has = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const access = { sales: has("sales.view"), finance: can.viewFinancials, projects: has("projects.view"), support: has("support.view"), notes: has("crm.notes.view"), files: has("crm.attachments.view") };
  const active = customer.status === "active";
  const refresh = () => {
    setDialog(null);
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customer", customerId) });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customers") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "options") });
  };

  const menu: Array<{ id: string; label: string; run: () => void }> = [
    ...(can.edit ? [{ id: "edit", label: "Edit customer", run: () => router.push(`/sales/customers/${customer.id}/edit`) }] : []),
    ...(customer.status === "active" && can.block ? [{ id: "block", label: "Block", run: () => setDialog("block") }] : []),
    ...(customer.status === "blocked" && can.unblock ? [{ id: "unblock", label: "Unblock", run: () => setDialog("unblock") }] : []),
    ...(customer.status !== "inactive" && can.inactivate ? [{ id: "deactivate", label: "Inactivate", run: () => setDialog("deactivate") }] : []),
    ...(customer.status === "inactive" && can.reactivate ? [{ id: "activate", label: "Reactivate", run: () => setDialog("activate") }] : []),
    ...(can.linkAccount ? [{ id: "link", label: "Link CRM account", run: () => setDialog("link") }] : []),
    ...(can.delete ? [{ id: "delete", label: "Delete customer", run: () => setDialog("delete") }] : []),
  ];

  return (
    <>
      <RecordDetailsPage
        header={{
          breadcrumbs: <LinkButton href="/sales/customers" variant="ghost" size="compact">Customers</LinkButton>,
          title: (
            <span className="flex flex-col">
              <span>{customer.displayName}</span>
              <span className="text-sm font-normal text-text-secondary">{[customer.customerNumber, customer.customerKindLabel].join(" · ")}</span>
            </span>
          ),
          status: <CustomerStatusBadge status={customer.status} />,
          fields: [
            { label: "Primary contact", value: customer.primaryContactName ?? "Not set" },
            { label: "Phone", value: customer.phone ?? customer.primaryContactPhone ?? "Not set" },
            { label: "Location", value: cityState(customer) || "Not set" },
            { label: "GSTIN", value: customer.gstin ?? "Not set" },
            { label: "Payment terms", value: customer.paymentTermName ?? "Not set" },
            { label: "Salesperson", value: customer.ownerName ?? "Unassigned" },
          ],
          primaryAction: access.sales && has("sales.quotation.create") && active
            ? <LinkButton href={`/sales/quotations/new?customer=${customer.id}`} variant="primary">New Quotation</LinkButton> : undefined,
          secondaryActions: (
            <>
              {access.sales && has("sales.order.create") && active && <LinkButton href={`/sales/orders/new?customer=${customer.id}`} variant="secondary">New Sales Order</LinkButton>}
              {access.sales && has("sales.invoice.request") && active && <LinkButton href="/sales/invoices" variant="secondary">New Invoice</LinkButton>}
              {menu.length > 0 && (
                <MenuTrigger>
                  <Button variant="outline" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
                  <Menu onAction={(key) => menu.find((entry) => entry.id === key)?.run()}>
                    {menu.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}
                  </Menu>
                </MenuTrigger>
              )}
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            <ErrorBanner message={error} />
            {customer.status === "blocked" && (
              <p role="status" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                Blocked{customer.blockedByName ? ` by ${customer.blockedByName}` : ""}{customer.blockedAt ? ` on ${formatDate(customer.blockedAt)}` : ""}: {customer.blockReason}. New quotations and sales orders cannot be created.
              </p>
            )}
            {customer.status === "inactive" && (
              <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm text-text-secondary">
                Inactive{customer.statusChangedByName ? ` since ${customer.statusChangedAt ? formatDate(customer.statusChangedAt) : ""} (${customer.statusChangedByName})` : ""}
                {customer.statusReason ? `: ${customer.statusReason}` : ""}. It cannot be chosen on new documents.
              </p>
            )}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Customer sections">
            <Tab id="overview">Overview</Tab>
            {can.viewAddresses && <Tab id="addresses">Addresses</Tab>}
            {can.viewContacts && <Tab id="contacts">Contacts</Tab>}
            {RELATED_TABS.filter((entry) => access[entry.needs]).map((entry) => <Tab key={entry.id} id={entry.id}>{entry.label}</Tab>)}
            {(access.notes || access.files) && <Tab id="notes">Notes &amp; Attachments</Tab>}
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview"><CustomerOverviewPanel customer={customer} onOpenTab={setTab} /></TabPanel>
          {can.viewAddresses && <TabPanel id="addresses"><CustomerAddressesPanel customer={customer} options={options} /></TabPanel>}
          {can.viewContacts && <TabPanel id="contacts"><CustomerContactsPanel customer={customer} options={options} /></TabPanel>}
          {RELATED_TABS.filter((entry) => access[entry.needs]).map((entry) => (
            <TabPanel key={entry.id} id={entry.id}><CustomerRelatedPanel customerId={customer.id} list={entry.id} /></TabPanel>
          ))}
          {(access.notes || access.files) && (
            <TabPanel id="notes">
              <div className="flex flex-col gap-6 pt-3">
                {access.notes && <RecordNotesPanel relatedType="party" relatedId={customer.id} />}
                {access.files && <RecordAttachmentsPanel relatedType="party" relatedId={customer.id} />}
              </div>
            </TabPanel>
          )}
          <TabPanel id="history"><CustomerHistoryPanel customerId={customer.id} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {(dialog === "block" || dialog === "unblock" || dialog === "activate" || dialog === "deactivate") && (
        <CustomerStatusDialog customer={customer} action={dialog} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog === "link" && <LinkAccountDialog customer={customer} onClose={() => setDialog(null)} onDone={refresh} />}
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)} title={`Delete ${customer.displayName}?`}
        description="This permanently removes the customer with its addresses and history. Only a customer with no quotations, orders, invoices or other records can be deleted; otherwise inactivate it."
        confirmLabel="Delete customer" onConfirm={() => remove.mutate()} isConfirming={remove.isPending} />
    </>
  );
}
