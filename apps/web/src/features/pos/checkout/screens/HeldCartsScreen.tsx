"use client";

// Held Carts: unpaid bills put on hold at the outlets the person works at — their own by default, everyone's for those allowed. Resuming
// opens the bill in the Register (prices, promotions, stock and GST are checked again there: nothing was reserved while it was held);
// cancelling needs a reason. A bill in checkout is not a held cart.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, SearchField, TextField } from "@vercentlabs/design-system";

import { cancelPosCart, listHeldPosCarts, type PosHeldCart } from "@/features/pos/checkout/api/checkout-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert } from "@/features/pos/shared/PosUi";
import { LoadingState } from "@/shared/ui/LoadingState";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const VIEWS = [{ id: "mine", label: "My held carts" }, { id: "all", label: "All authorized" }];

export function HeldCartsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [from, setFrom] = useState("");
  const [cancelling, setCancelling] = useState<PosHeldCart | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "held-carts", submitted, scope, from),
    queryFn: () => listHeldPosCarts({ search: submitted || undefined, scope, from: from || undefined }),
    refetchInterval: 15_000,
  });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<PosHeldCart, unknown>[]>(() => [
    { id: "cart_reference", accessorKey: "cart_reference", header: "Bill", cell: ({ row }) => <span className="font-medium text-text">{row.original.cart_reference ?? "Bill"}</span> },
    { id: "customer_name", accessorKey: "customer_name", header: "Customer", cell: ({ row }) => row.original.customer_name ?? "Walk-in" },
    { id: "line_count", accessorKey: "line_count", header: "Items", cell: ({ row }) => <span className="tabular-nums">{row.original.line_count}</span> },
    { id: "grand_total", accessorKey: "grand_total", header: "Total", cell: ({ row }) => <span className="tabular-nums">{money(row.original.currency_code, row.original.grand_total)}</span> },
    { id: "where", header: "Counter", cell: ({ row }) => `${row.original.store_name} · ${row.original.terminal_name}` },
    { id: "cashier_name", accessorKey: "cashier_name", header: "Held by", cell: ({ row }) => row.original.cashier_name ?? "—" },
    { id: "held_at", accessorKey: "held_at", header: "Held", cell: ({ row }) => dateTime(row.original.held_at) },
    { id: "hold_note", accessorKey: "hold_note", header: "Note", cell: ({ row }) => row.original.hold_note ?? "" },
    { id: "actions", header: "", cell: ({ row }) => (
      <span className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
        <Button size="compact" variant="secondary" onPress={() => router.push(`/pos/register?resume=${row.original.id}`)}>Resume</Button>
        <Button size="compact" variant="ghost" onPress={() => setCancelling(row.original)}>Cancel</Button>
      </span>) },
  ], [router]);
  return (
    <EnterpriseListPage
      header={{ title: "Held Carts", description: "Bills put on hold before payment. Resuming opens the bill in the Register, where prices, discounts, stock and GST are checked again." }}
      savedViews={{ views: VIEWS, activeViewId: scope, onSelect: (id) => { setScope(id === "all" ? "all" : "mine"); paged.resetPage(); } }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search held carts" placeholder="Reference, customer, counter or note" className="w-full sm:w-80" value={search} onChange={setSearch} />
          <TextField aria-label="Held on or after" size="compact" type="date" value={from} onChange={setFrom} />
        </>
      ) }}
    >
      <EnterpriseDataGrid<PosHeldCart>
        aria-label="Held carts" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<LoadingState label="Loading held carts" rows={6} />}
        errorContent={<ErrorState title="Could not load held carts" description={query.error instanceof Error ? query.error.message : "Try again."} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="No held carts" description="Bills put on hold in the Register appear here until they are resumed or cancelled." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`/pos/register?resume=${row.id}`)}
      />
      {cancelling && <CancelDialog cart={cancelling} onClose={() => setCancelling(null)}
        onDone={() => { setCancelling(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "held-carts") }); }} />}
    </EnterpriseListPage>
  );
}

function CancelDialog({ cart, onClose, onDone }: { cart: PosHeldCart; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    setError(null);
    try { await cancelPosCart(cart.id, reason.trim()); onDone(); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "The bill could not be cancelled."); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Cancel ${cart.cart_reference ?? "bill"}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">The bill is cancelled and cannot be resumed. Nothing was paid on it.</p>
        <TextField label="Reason" value={reason} onChange={setReason} maxLength={200} isRequired />
        {error && <PosAlert>{error}</PosAlert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Keep it</Button>
          <Button variant="primary" isLoading={busy} isDisabled={reason.trim().length < 3} onPress={cancel}>Cancel bill</Button>
        </div>
      </div>
    </Dialog>
  );
}
