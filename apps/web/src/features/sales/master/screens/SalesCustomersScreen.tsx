"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, NumberField, PermissionState, SearchField, Select, StatusBadge, TextField, type ActiveFilter } from "@vercentlabs/design-system";
import { BUSINESS_DATA_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { SalesAlert } from "@/features/sales/shared/SalesUi";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { createRecord, listCustomers, updateRecord, type CustomerInput, type CustomerRecord } from "@/features/sales/master/api/master-api";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Archived" },
  { value: "all", label: "All" },
];
const TYPE_OPTIONS = [
  { value: "customer", label: "Customer" },
  { value: "prospect", label: "Prospect" },
  { value: "both", label: "Customer and supplier" },
];

// F031 -- the customer master as Sales sees it. Company scoping, duplicate
// handling and the credit-limit rule all live server-side; this screen collects
// and shows.
export function SalesCustomersScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const canManage = can(BUSINESS_DATA_PERMISSIONS.partiesManage);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "customers", status, search),
    queryFn: () => listCustomers({ status, search: search.trim() || undefined }),
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.rows ?? [];
  const denied = query.isError && query.error instanceof SalesApiError && query.error.status === 403;

  const columns: ColumnDef<CustomerRecord, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code" },
      { id: "name", header: "Customer", accessorKey: "displayName", cell: ({ row }) => <span className="font-medium text-text">{row.original.displayName}</span> },
      { id: "type", header: "Type", accessorFn: (row) => statusLabel(row.partyType) },
      { id: "gstin", header: "GSTIN", accessorFn: (row) => row.gstin ?? "—" },
      { id: "currency", header: "Currency", accessorFn: (row) => row.currencyCode ?? "—" },
      { id: "credit", header: "Credit limit", accessorFn: (row) => (Number(row.creditLimit) > 0 ? money(row.currencyCode, row.creditLimit) : "No limit") },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.status === "active" ? "confirmed" : "cancelled")}>{row.original.status === "active" ? "Active" : "Archived"}</StatusBadge> },
    ],
    [],
  );

  const filters: ActiveFilter[] = [];
  if (status !== "active") filters.push({ id: "status", label: `Status: ${STATUS_OPTIONS.find((o) => o.value === status)?.label}` });
  if (search.trim()) filters.push({ id: "search", label: `Search: ${search.trim()}` });
  function clear() {
    setStatus("active");
    setSearch("");
  }

  if (denied) return <PermissionState title="You don't have access to Sales" description="Ask an administrator to grant sales.view." />;

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Customers",
          description: "Who you sell to — terms, currency and credit limit that flow onto every quotation and order.",
          primaryAction: canManage ? (
            <Button variant="primary" onPress={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New customer
            </Button>
          ) : undefined,
        }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search customers" placeholder="Search code, name, GSTIN…" value={search} onChange={setSearch} className="min-w-[280px]" />
              <Select aria-label="Status" size="compact" options={STATUS_OPTIONS} selectedKey={status} onSelectionChange={(key) => setStatus(String(key ?? "active"))} />
            </>
          ),
        }}
        filterBar={{ filters, onRemove: (id) => (id === "status" ? setStatus("active") : setSearch("")), onClearAll: filters.length ? clear : undefined }}
      >
        <EnterpriseDataGrid<CustomerRecord>
          aria-label="Customers"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 && filters.length ? "no-results" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading customers…</p>}
          emptyContent={<NoResultsState title="No customers yet" description="Add the first customer to start quoting." action={canManage ? { label: "New customer", onPress: () => setCreating(true) } : undefined} />}
          noResultsContent={<NoResultsState title="No customers match" description="Try clearing a filter." action={{ label: "Clear filters", onPress: clear }} />}
          errorContent={<ErrorState title="Could not load customers" action={{ label: "Retry", onPress: () => query.refetch() }} />}
          onRowClick={(row) => router.push(`/sales/customers/${row.id}`)}
        />
      </EnterpriseListPage>
      {creating && <CustomerDialog onClose={() => setCreating(false)} onSaved={(id) => router.push(`/sales/customers/${id}`)} />}
    </>
  );
}

type DuplicateMatch = { id: string; display_name: string; legal_name: string | null; code: string; gstin: string | null; pan: string | null };

// Create or edit. Shared with the detail page.
export function CustomerDialog({ customer, onClose, onSaved }: { customer?: CustomerRecord; onClose: () => void; onSaved: (id: string) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options) });
  const [code, setCode] = useState(customer?.code ?? "");
  const [displayName, setDisplayName] = useState(customer?.displayName ?? "");
  const [legalName, setLegalName] = useState(customer?.legalName ?? "");
  const [partyType, setPartyType] = useState<string>(customer?.partyType ?? "customer");
  const [gstin, setGstin] = useState(customer?.gstin ?? "");
  const [pan, setPan] = useState(customer?.pan ?? "");
  const [currencyCode, setCurrencyCode] = useState(customer?.currencyCode ?? "");
  const [paymentTermId, setPaymentTermId] = useState(customer?.paymentTermId ?? "");
  const [creditLimit, setCreditLimit] = useState(Number(customer?.creditLimit ?? 0));
  // Populated only after the server blocks on an exact duplicate (409
  // SALES_PARTY_DUPLICATE_EXACT); once shown, the user must explain why
  // before resubmitting.
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[] | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const input: CustomerInput = {
        ...(customer ? {} : { code }),
        displayName,
        legalName: legalName || undefined,
        partyType: partyType as CustomerRecord["partyType"],
        gstin: gstin || undefined,
        pan: pan || undefined,
        currencyCode: currencyCode || undefined,
        paymentTermId: paymentTermId || undefined,
        creditLimit,
        ...(duplicateMatches ? { duplicateOverrideReason: overrideReason } : {}),
        ...(customer ? { expectedUpdatedAt: customer.updatedAt } : {}),
      };
      const result = customer ? await updateRecord<CustomerRecord>("parties", customer.id, input) : await createRecord<CustomerRecord>("parties", input);
      return result.record.id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales") });
      onSaved(id);
    },
    onError: (err) => {
      if (err instanceof SalesApiError && err.code === "SALES_PARTY_DUPLICATE_EXACT") {
        setDuplicateMatches((err.payload?.matches as DuplicateMatch[]) ?? []);
      }
    },
  });
  const isStaleWrite = mutation.error instanceof SalesApiError && mutation.error.code === "STALE_WRITE";
  const message = mutation.error && !isStaleWrite && !duplicateMatches ? (mutation.error instanceof SalesApiError ? mutation.error.message : "The customer could not be saved.") : null;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={customer ? "Edit customer" : "New customer"}>
      <div className="flex flex-col gap-4">
        {message && <SalesAlert>{message}</SalesAlert>}
        {isStaleWrite && (
          <SalesAlert>
            This customer changed after you opened it.{" "}
            <button type="button" className="underline" onClick={() => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customer", customer?.id) })}>
              Refresh
            </button>{" "}
            and try again.
          </SalesAlert>
        )}
        {duplicateMatches && (
          <SalesAlert tone="warning">
            <div className="flex flex-col gap-2">
              <p>This looks like an exact duplicate of an existing customer:</p>
              <ul className="list-disc pl-5">
                {duplicateMatches.map((match) => (
                  <li key={match.id}>
                    {match.display_name} ({match.code}){match.gstin ? ` — GSTIN ${match.gstin}` : ""}
                  </li>
                ))}
              </ul>
              <TextField label="Why create this anyway?" value={overrideReason} onChange={setOverrideReason} placeholder="Explain in at least 10 characters" />
            </div>
          </SalesAlert>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Code" isRequired value={code} onChange={setCode} isDisabled={Boolean(customer)} />
          <Select label="Type" options={TYPE_OPTIONS} selectedKey={partyType} onSelectionChange={(key) => setPartyType(String(key ?? "customer"))} />
          <TextField label="Display name" isRequired value={displayName} onChange={setDisplayName} />
          <TextField label="Legal name" value={legalName} onChange={setLegalName} />
          <TextField label="GSTIN" value={gstin} onChange={setGstin} />
          <TextField label="PAN" value={pan} onChange={setPan} />
          <Select label="Currency" options={[{ value: "", label: "Company default" }, ...(options.data?.currencies ?? []).map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))]} selectedKey={currencyCode} onSelectionChange={(key) => setCurrencyCode(String(key ?? ""))} />
          <Select label="Payment terms" options={[{ value: "", label: "None" }, ...(options.data?.paymentTerms ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.default_due_days} days)` }))]} selectedKey={paymentTermId} onSelectionChange={(key) => setPaymentTermId(String(key ?? ""))} />
          <NumberField label="Credit limit (0 = no limit)" value={creditLimit} onChange={setCreditLimit} minValue={0} step={0.01} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!displayName.trim() || (!customer && !code.trim()) || Boolean(duplicateMatches && overrideReason.trim().length < 10)}
          >
            {duplicateMatches ? "Create anyway" : customer ? "Save changes" : "Create customer"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
