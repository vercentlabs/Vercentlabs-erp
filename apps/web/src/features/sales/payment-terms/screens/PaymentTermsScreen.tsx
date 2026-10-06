"use client";

// Sales → Payment Terms: the terms offered on customers, quotations, orders
// and invoices. A term says when payment is due, never how to pay or whether
// something is paid. A term already in use keeps its meaning (make a new one
// for other days) and is deactivated, never deleted; documents keep the terms
// they were agreed with.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NumberField, PermissionState, Select, StatusBadge, TextArea, TextField,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError } from "@/features/sales/shared/http";
import { SalesAlert } from "@/features/sales/shared/SalesUi";

import {
  activatePaymentTerm, createPaymentTerm, deactivatePaymentTerm, listPaymentTerms, setDefaultPaymentTerm, updatePaymentTerm, type CalculationType, type PaymentTerm,
} from "../api/payment-terms-api";

const failureText = (failure: unknown, fallback: string) => (failure instanceof SalesApiError || failure instanceof Error ? failure.message || fallback : fallback);
const VIEWS = [{ id: "all", label: "All Terms" }, { id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }];
const dueText = (term: Pick<PaymentTerm, "calculationType" | "days">) =>
  term.calculationType === "net_days" ? `${term.days} day${term.days === 1 ? "" : "s"} from the invoice date` : term.calculationType === "due_on_receipt" ? "On the invoice date" : "Entered on each invoice";

export function PaymentTermsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [view, setView] = useState("all");
  const [editing, setEditing] = useState<PaymentTerm | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = scopedQueryKey(workspace, "sales", "payment-terms", view);
  const query = useQuery({ queryKey: key, queryFn: () => listPaymentTerms(view) });
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "payment-terms") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "options") });
  };
  const act = useMutation({
    mutationFn: ({ kind, id }: { kind: "activate" | "deactivate" | "default"; id: string }) =>
      (kind === "activate" ? activatePaymentTerm(id) : kind === "deactivate" ? deactivatePaymentTerm(id) : setDefaultPaymentTerm(id)) as Promise<unknown>,
    onSuccess: refresh,
    onError: (failure) => setError(failureText(failure, "That could not be done.")),
  });
  const capabilities = query.data?.capabilities;
  const rows = query.data?.rows ?? [];

  const columns = useMemo<ColumnDef<PaymentTerm, unknown>[]>(() => [
    { id: "code", header: "Code", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.code}</span> },
    { id: "name", header: "Name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
    { id: "calculation", header: "Calculation", cell: ({ row }) => row.original.calculationLabel },
    { id: "days", header: "Days", cell: ({ row }) => <span className="tabular-nums">{row.original.days ?? "—"}</span> },
    { id: "description", header: "Customer-facing description", cell: ({ row }) => <span className="text-text-secondary">{row.original.description ?? ""}</span> },
    { id: "default", header: "Default", cell: ({ row }) => (row.original.isDefaultSales ? <StatusBadge tone="info">Default for Sales</StatusBadge> : "") },
    { id: "used", header: "Used by", cell: ({ row }) => <span className="whitespace-nowrap text-text-secondary">{row.original.customers} customer(s) · {row.original.documents} document(s)</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? "Active" : "Inactive"}</StatusBadge> },
    {
      id: "actions", header: "",
      cell: ({ row }) => {
        const term = row.original;
        return (
          <span className="flex flex-wrap justify-end gap-1">
            {capabilities?.manage && <Button variant="ghost" size="compact" onPress={() => setEditing(term)}>Edit</Button>}
            {capabilities?.setDefault && term.status === "active" && term.salesEnabled && !term.isDefaultSales && (
              <Button variant="ghost" size="compact" isDisabled={act.isPending} onPress={() => act.mutate({ kind: "default", id: term.id })}>Set as Default</Button>
            )}
            {capabilities?.manage && (term.status === "active"
              ? <Button variant="ghost" size="compact" isDisabled={act.isPending || term.isDefaultSales} onPress={() => act.mutate({ kind: "deactivate", id: term.id })}>Deactivate</Button>
              : <Button variant="ghost" size="compact" isDisabled={act.isPending} onPress={() => act.mutate({ kind: "activate", id: term.id })}>Activate</Button>)}
          </span>
        );
      },
    },
  ], [capabilities, act]);

  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to payment terms" description="Ask an administrator for the View payment terms permission." />;

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Payment Terms",
          description: "When payment is due on quotations, orders and invoices. New documents take the customer's terms, else the default here; each document then keeps the terms it was agreed with, whatever changes later.",
          primaryAction: capabilities?.manage ? <Button variant="primary" onPress={() => setEditing("new")}>New Payment Term</Button> : undefined,
        }}
        savedViews={{ views: VIEWS, activeViewId: view, onSelect: setView }}
      >
        {error && <SalesAlert className="mb-3">{error}</SalesAlert>}
        <EnterpriseDataGrid<PaymentTerm>
          aria-label="Payment terms"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<LoadingState label="Loading payment terms" rows={6} onRetry={() => void query.refetch()} />}
          errorContent={<ErrorState title="Could not load payment terms" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No payment terms" description="Create the terms your customers are offered, such as Net 30." />}
          renderMobileCard={(term) => (
            <div className="flex flex-col gap-1">
              <span className="font-medium">{term.name} <span className="text-text-muted tabular-nums">{term.code}</span></span>
              <span className="text-xs text-text-muted">{dueText(term)}</span>
              <span className="flex flex-wrap gap-1">{term.isDefaultSales && <StatusBadge tone="info">Default</StatusBadge>}<StatusBadge tone={term.status === "active" ? "success" : "neutral"}>{term.status === "active" ? "Active" : "Inactive"}</StatusBadge></span>
            </div>
          )}
        />
      </EnterpriseListPage>
      {editing && <TermDialog term={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
    </>
  );
}

const TYPES: Array<{ value: CalculationType; label: string }> = [
  { value: "net_days", label: "Net days: due a number of days after the invoice date" },
  { value: "due_on_receipt", label: "Due on receipt: due on the invoice date" },
  { value: "custom", label: "Custom: described in words; the due date is entered on each invoice" },
];

function TermDialog({ term, onClose, onDone }: { term: PaymentTerm | null; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(term?.code ?? "");
  const [name, setName] = useState(term?.name ?? "");
  const [calculationType, setCalculationType] = useState<CalculationType>(term?.calculationType ?? "net_days");
  const [days, setDays] = useState<number>(term?.days ?? 30);
  const [description, setDescription] = useState(term?.description ?? "");
  const [salesEnabled, setSalesEnabled] = useState(term?.salesEnabled ?? true);
  const [purchaseEnabled, setPurchaseEnabled] = useState(term?.purchaseEnabled ?? true);
  // What a term means is fixed once customers or documents carry it.
  const locked = Boolean(term?.inUse);
  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(), description: description.trim() || null, salesEnabled, purchaseEnabled,
        ...(locked ? {} : { calculationType, days: calculationType === "net_days" ? days : null }),
      };
      return (term ? updatePaymentTerm(term.id, input) : createPaymentTerm({ ...input, code: code.trim(), calculationType, days: calculationType === "net_days" ? days : null })) as Promise<unknown>;
    },
    onSuccess: onDone,
  });
  const valid = name.trim() && (term || code.trim()) && (calculationType !== "net_days" || (Number.isInteger(days) && days >= 0));
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={term ? `Edit ${term.name}` : "New payment term"}
      description="A payment term says when payment is due. How and where to pay, discounts for paying early and late fees are not payment terms." size="lg">
      <div className="flex flex-col gap-3">
        {Boolean(save.error) && <SalesAlert>{failureText(save.error, "The payment term could not be saved.")}</SalesAlert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Code" isRequired isDisabled={Boolean(term)} description={term ? "The code never changes." : "Short and stable, for example NET30."} value={code} onChange={(value) => setCode(value.toUpperCase())} />
          <TextField label="Name" isRequired description="What people read on documents, for example Net 30 Days." value={name} onChange={setName} />
        </div>
        {locked && (
          <SalesAlert tone="info">{term!.name} is used by {term!.customers} customer(s) and {term!.documents} document(s), so the way its due date is worked out cannot change. For other days, create a new term (for example NET45) and use that from now on.</SalesAlert>
        )}
        <Select label="Due date" isRequired isDisabled={locked} selectedKey={calculationType} options={TYPES} onSelectionChange={(selected) => setCalculationType(String(selected ?? "net_days") as CalculationType)} />
        {calculationType === "net_days" && (
          <NumberField label="Number of days" isRequired isDisabled={locked} description="Calendar days after the invoice date." value={days} minValue={0} maxValue={3650} step={1}
            onChange={(value) => setDays(Number.isFinite(value) ? Math.round(value) : 0)} />
        )}
        {calculationType === "custom" && (
          <SalesAlert tone="info">A custom term records the commercial agreement in words (for example &quot;50% advance, balance before dispatch&quot;). It creates no invoices, receipts or instalments, and each invoice&apos;s due date is entered before it is posted.</SalesAlert>
        )}
        <TextArea label="Customer-facing description" description="Printed with the term on quotations, order confirmations and invoices. Never internal notes or bank details." value={description} onChange={setDescription} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Available for Sales" selectedKey={salesEnabled ? "yes" : "no"} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} onSelectionChange={(selected) => setSalesEnabled(selected === "yes")} />
          <Select label="Available for Purchases" selectedKey={purchaseEnabled ? "yes" : "no"} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} onSelectionChange={(selected) => setPurchaseEnabled(selected === "yes")} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!valid} onPress={() => save.mutate()}>{term ? "Save" : "Create Payment Term"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
