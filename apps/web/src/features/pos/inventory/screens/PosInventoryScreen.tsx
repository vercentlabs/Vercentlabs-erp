"use client";

// F294/F295/F296 (POS-CAP-006) -- one consolidated "POS Inventory" workspace
// covering store availability/lot-batch visibility (F295/F296) AND the
// real-time feed of stock movements a completed POS sale/return actually
// caused (F294), plus a store-scoped view into the same offline-sync
// exceptions the dedicated Offline Sync Conflicts screen resolves (F297/
// F298). This replaced two separate `planned()` nav placeholders
// ("POS Inventory" and "Stock Sync") -- the F294/F295/F296 dossiers
// describe one coherent read-only inventory-visibility workflow for POS,
// not two independent screens, and Stock itself (not POS) remains the only
// place a balance/movement is ever written -- see inventory-api.ts and
// services/api/src/modules/point-of-sale/inventory-and-offline-continuity/
// inventory-visibility.js.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import {
  Button,
  EnterpriseDataGrid,
  ErrorState,
  NoResultsState,
  PageHeader,
  PermissionState,
  SearchField,
  Select,
  StatusBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime } from "@/features/pos/shared/format";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { listPosStoreInventory, listPosStoreStockActivity, type PosStoreInventoryRow, type PosStoreStockActivityRow } from "@/features/pos/inventory/api/inventory-api";
import { listPosOfflineSyncConflicts, POS_CONFLICT_TYPE_LABEL, type PosOfflineSyncConflict } from "@/features/pos/offline/api/offline-api";

function formatQty(value: string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : String(value);
}

export function PosInventoryScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const canResolveOffline = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.offlineResolve);

  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores });
  const stores = useMemo(() => storesQuery.data?.rows ?? [], [storesQuery.data?.rows]);
  const activeStoreId = storeId || stores[0]?.id || "";
  const storeOptions = useMemo(() => stores.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })), [stores]);

  const inventoryQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "inventory", activeStoreId, search),
    queryFn: () => listPosStoreInventory({ storeId: activeStoreId, search: search || undefined, limit: 100 }),
    enabled: Boolean(activeStoreId),
    placeholderData: (previous) => previous,
  });
  const activityQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "inventory-activity", activeStoreId),
    queryFn: () => listPosStoreStockActivity({ storeId: activeStoreId, limit: 100 }),
    enabled: Boolean(activeStoreId),
    placeholderData: (previous) => previous,
  });
  const exceptionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "inventory-exceptions", activeStoreId),
    queryFn: () => listPosOfflineSyncConflicts({ status: "pending", storeId: activeStoreId }),
    enabled: Boolean(activeStoreId) && canResolveOffline,
  });

  const inventoryRows = inventoryQuery.data?.rows ?? [];
  const activityRows = activityQuery.data?.rows ?? [];
  const exceptionRows = exceptionsQuery.data?.conflicts ?? [];

  const inventoryColumns: ColumnDef<PosStoreInventoryRow, unknown>[] = useMemo(
    () => [
      { id: "item_name", header: "Item", accessorFn: (row) => row.item_name, cell: ({ row }) => <span className="font-medium text-text">{row.original.item_name}</span> },
      { id: "item_code", header: "Code", accessorKey: "item_code" },
      { id: "barcode", header: "Barcode", accessorFn: (row) => row.barcode || "—" },
      { id: "tracking_type", header: "Tracking", accessorFn: (row) => (row.tracking_type === "none" ? "—" : row.tracking_type) },
      { id: "location_code", header: "Location", accessorFn: (row) => row.location_code || "—" },
      { id: "batch_number", header: "Batch", accessorFn: (row) => row.batch_number || "—" },
      { id: "on_hand_quantity", header: "On hand", accessorFn: (row) => formatQty(row.on_hand_quantity) },
      { id: "reserved_quantity", header: "Reserved", accessorFn: (row) => formatQty(row.reserved_quantity) },
      { id: "available_quantity", header: "Available", accessorFn: (row) => formatQty(row.available_quantity) },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          if (row.original.quality_held) return <StatusBadge tone="danger">Quality hold</StatusBadge>;
          const available = Number(row.original.available_quantity);
          if (available <= 0) return <StatusBadge tone="warning">Out of stock</StatusBadge>;
          return <StatusBadge tone="success">Available</StatusBadge>;
        },
      },
    ],
    [],
  );

  const activityColumns: ColumnDef<PosStoreStockActivityRow, unknown>[] = useMemo(
    () => [
      { id: "occurred_at", header: "When", accessorFn: (row) => dateTime(row.occurred_at) },
      { id: "movement_type", header: "Type", cell: ({ getValue }) => <StatusBadge tone={String(getValue()) === "issue" ? "warning" : "success"}>{String(getValue())}</StatusBadge>, accessorKey: "movement_type" },
      { id: "item_name", header: "Item", accessorKey: "item_name" },
      { id: "quantity", header: "Qty", accessorFn: (row) => formatQty(row.quantity) },
      { id: "movement_number", header: "Movement #", accessorKey: "movement_number" },
      {
        id: "origin",
        header: "Origin transaction",
        cell: ({ row }) => {
          const r = row.original;
          if (r.reference_type === "pos_sale" && r.sale_id) {
            return (
              <button
                type="button"
                className="text-brand underline-offset-2 hover:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push(`/pos/transactions/${r.sale_id}`);
                }}
              >
                Sale {r.sale_receipt_number ?? r.sale_id}
              </button>
            );
          }
          if (r.reference_type === "pos_return" && r.return_id) {
            return (
              <button
                type="button"
                className="text-brand underline-offset-2 hover:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push("/pos/returns");
                }}
              >
                Return {r.return_number ?? r.return_id}
              </button>
            );
          }
          return "—";
        },
      },
    ],
    [router],
  );

  const exceptionColumns: ColumnDef<PosOfflineSyncConflict, unknown>[] = useMemo(
    () => [
      { id: "created_at", header: "Captured", accessorFn: (row) => dateTime(row.created_at) },
      { id: "conflict_type", header: "Reason", accessorFn: (row) => POS_CONFLICT_TYPE_LABEL[row.conflict_type] ?? row.conflict_type },
      { id: "detail", header: "Detail", accessorFn: (row) => row.detail || "—" },
      { id: "status", header: "Status", cell: ({ getValue }) => <StatusBadge tone="warning">{String(getValue())}</StatusBadge>, accessorKey: "status" },
    ],
    [],
  );

  const inventoryState = inventoryQuery.isLoading
    ? "loading"
    : inventoryQuery.isError && inventoryQuery.error instanceof PosApiError && inventoryQuery.error.status === 403
      ? "permission-denied"
      : inventoryQuery.isError
        ? "error"
        : inventoryRows.length === 0
          ? "empty"
          : "ready";

  const activityState = activityQuery.isLoading
    ? "loading"
    : activityQuery.isError && activityQuery.error instanceof PosApiError && activityQuery.error.status === 403
      ? "permission-denied"
      : activityQuery.isError
        ? "error"
        : activityRows.length === 0
          ? "empty"
          : "ready";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Real-time store availability, lot/batch and stock-sync activity from Stock's own ledger. POS never keeps its own copy of stock balances — every figure here is read live from the Stock module."
        secondaryActions={
          <Select
            aria-label="Store"
            size="compact"
            options={storeOptions}
            selectedKey={activeStoreId}
            onSelectionChange={(key) => setStoreId(key ? String(key) : "")}
            isDisabled={storeOptions.length === 0}
          />
        }
        primaryAction={
          <Button variant="secondary" onPress={() => router.push("/inventory")}>
            <ExternalLink className="size-4" aria-hidden="true" />
            Open in Stock
          </Button>
        }
      />

      {!activeStoreId ? (
        <NoResultsState title="No POS store available" description="Create a store before viewing its inventory." />
      ) : (
        <Tabs>
          <TabList aria-label="POS inventory sections">
            <Tab id="availability">Availability</Tab>
            <Tab id="activity">Sync activity</Tab>
            <Tab id="exceptions">Exceptions</Tab>
          </TabList>

          <TabPanel id="availability">
            <div className="flex flex-col gap-3 py-4">
              <SearchField aria-label="Search inventory" placeholder="Search item, code or barcode…" value={search} onChange={setSearch} className="max-w-sm" />
              <EnterpriseDataGrid<PosStoreInventoryRow>
                aria-label="Store inventory"
                columns={inventoryColumns}
                data={inventoryRows}
                getRowId={(row) => `${row.item_id}:${row.warehouse_location_id ?? ""}:${row.batch_id ?? ""}`}
                state={inventoryState}
                loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading inventory…</p>}
                emptyContent={<NoResultsState title="No stock at this store" description="No stock balances were found for the store's warehouse." />}
                errorContent={<ErrorState title="Could not load inventory" action={{ label: "Retry", onPress: () => inventoryQuery.refetch() }} />}
                permissionDeniedContent={<PermissionState title="You don't have access to store inventory" />}
              />
            </div>
          </TabPanel>

          <TabPanel id="activity">
            <div className="py-4">
              <EnterpriseDataGrid<PosStoreStockActivityRow>
                aria-label="Stock sync activity"
                columns={activityColumns}
                data={activityRows}
                getRowId={(row) => row.id}
                state={activityState}
                loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading stock movements…</p>}
                emptyContent={<NoResultsState title="No POS-caused stock movements yet" description="Sales and returns at this store will appear here as they post to Stock." />}
                errorContent={<ErrorState title="Could not load stock activity" action={{ label: "Retry", onPress: () => activityQuery.refetch() }} />}
                permissionDeniedContent={<PermissionState title="You don't have access to stock activity" />}
              />
            </div>
          </TabPanel>

          <TabPanel id="exceptions">
            <div className="flex flex-col gap-3 py-4">
              {!canResolveOffline ? (
                <PermissionState title="You don't have access to sync exceptions" description="Resolving offline-sync exceptions requires the offline-resolve permission." />
              ) : (
                <>
                  <p className="text-sm text-text-secondary">
                    Pending offline-sale sync exceptions for this store (including insufficient-stock conflicts). Resolve them in the{" "}
                    <button type="button" className="text-brand underline-offset-2 hover:underline" onClick={() => router.push("/pos/offline-sync-conflicts")}>
                      Offline Sync Conflicts
                    </button>{" "}
                    workspace.
                  </p>
                  <EnterpriseDataGrid<PosOfflineSyncConflict>
                    aria-label="Stock sync exceptions"
                    columns={exceptionColumns}
                    data={exceptionRows}
                    getRowId={(row) => row.id}
                    onRowClick={() => router.push("/pos/offline-sync-conflicts")}
                    state={exceptionsQuery.isLoading ? "loading" : exceptionRows.length === 0 ? "empty" : "ready"}
                    loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading exceptions…</p>}
                    emptyContent={<NoResultsState title="No pending sync exceptions" description="Every offline sale from this store has synced cleanly." />}
                    errorContent={<ErrorState title="Could not load exceptions" action={{ label: "Retry", onPress: () => exceptionsQuery.refetch() }} />}
                    permissionDeniedContent={<PermissionState title="You don't have access to sync exceptions" />}
                  />
                </>
              )}
            </div>
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}
