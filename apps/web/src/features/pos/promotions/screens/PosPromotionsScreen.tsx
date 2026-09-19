"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Power } from "lucide-react";
import { Button, Checkbox, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, NumberField, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosPromotion } from "@vercentlabs/api";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { createPosPromotion, listPosPromotions, setPosPromotionActive, updatePosPromotion } from "@/features/pos/promotions/api/promotions-api";
import { searchPosProducts, searchPosCustomers } from "@/features/pos/checkout/api/checkout-api";
import { searchPosItemGroups } from "@/features/pos/shared/eligibility-api";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { EligibilitySearchPicker } from "@/features/pos/shared/EligibilitySearchPicker";

// F280 -- real promotion administration against the F280 backend
// (assortment-pricing-customer-and-cart/promotions.js): list/search(status)/
// create/edit/activate-deactivate, every field mapping to a real backend
// column (no decorative inputs), including item/item-group/customer
// eligibility via EligibilitySearchPicker (closes a previously disclosed
// gap -- no item/item-group search-select existed anywhere in the app).
export function PosPromotionsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.settingsManage);

  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PosPromotion | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "promotions", statusFilter),
    queryFn: () => listPosPromotions(statusFilter === "all" ? undefined : statusFilter),
    enabled: canManage,
  });
  const rows = query.data?.rows ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "promotions") });
  }
  function handleError(err: unknown) {
    setError(err instanceof PosApiError ? err.message : "This action could not be completed.");
  }

  const toggleActiveMutation = useMutation({
    mutationFn: (promotion: PosPromotion) => setPosPromotionActive(promotion.id, promotion.status !== "active"),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const columns: ColumnDef<PosPromotion, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code", cell: ({ row }) => <span className="font-medium text-text">{row.original.code}</span> },
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "discount", header: "Discount", accessorFn: (row) => (row.discount_type === "percent" ? `${row.discount_value}%` : row.discount_value) },
      { id: "priority", header: "Priority", accessorKey: "priority" },
      { id: "usage", header: "Usage", accessorFn: (row) => `${row.usage_count ?? 0}${row.usage_limit_total ? ` / ${row.usage_limit_total}` : ""}` },
      { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status}</StatusBadge> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <span onClick={(event) => event.stopPropagation()}>
            <IconButton
              aria-label={row.original.status === "active" ? `Deactivate ${row.original.name}` : `Activate ${row.original.name}`}
              size="compact"
              variant={row.original.status === "active" ? "danger" : "ghost"}
              onPress={() => toggleActiveMutation.mutate(row.original)}
              isDisabled={toggleActiveMutation.isPending}
            >
              <Power className="size-4" aria-hidden="true" />
            </IconButton>
          </span>
        ),
      },
    ],
    [toggleActiveMutation],
  );

  if (!canManage) return <PermissionState title="You don't have access to Promotion settings" description="Ask an administrator to grant pos.settings.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Promotions",
          description: "Automatic discounts applied during checkout when a cart is eligible.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New promotion
            </Button>
          ),
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <Select
            aria-label="Filter by status"
            size="compact"
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            selectedKey={statusFilter}
            onSelectionChange={(key) => setStatusFilter(String(key ?? "all"))}
          />
        </div>
        <EnterpriseDataGrid<PosPromotion>
          aria-label="Promotions"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isError ? "error" : query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
          errorContent={<ErrorState title="Could not load promotions" description="Something went wrong fetching the promotion list." action={{ label: "Retry", onPress: () => query.refetch() }} />}
          onRowClick={(row) => setEditing(row)}
        />
      </EnterpriseListPage>

      <PromotionFormDialog isOpen={createOpen} onOpenChange={setCreateOpen} onSaved={invalidate} onError={handleError} />
      {editing && (
        <PromotionFormDialog
          isOpen
          promotion={editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={() => {
            invalidate();
            setEditing(null);
          }}
          onError={handleError}
        />
      )}
    </div>
  );
}

function PromotionFormDialog({
  isOpen,
  onOpenChange,
  promotion,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  promotion?: PosPromotion;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const isEdit = Boolean(promotion);
  const [code, setCode] = useState(promotion?.code ?? "");
  const [name, setName] = useState(promotion?.name ?? "");
  const [description, setDescription] = useState((promotion?.description as string) ?? "");
  const [discountType, setDiscountType] = useState<string>((promotion?.discount_type as string) ?? "percent");
  const [discountValue, setDiscountValue] = useState(Number(promotion?.discount_value ?? 10));
  const [maxDiscountAmount, setMaxDiscountAmount] = useState(Number(promotion?.max_discount_amount ?? 0));
  const [minQuantity, setMinQuantity] = useState(Number(promotion?.min_quantity ?? 0));
  const [minBasketAmount, setMinBasketAmount] = useState(Number(promotion?.min_basket_amount ?? 0));
  const [priority, setPriority] = useState(Number(promotion?.priority ?? 100));
  const [stackable, setStackable] = useState(Boolean(promotion?.stackable));
  const [exclusive, setExclusive] = useState(Boolean(promotion?.exclusive));
  const [usageLimitTotal, setUsageLimitTotal] = useState(Number(promotion?.usage_limit_total ?? 0));
  const [usageLimitPerCustomer, setUsageLimitPerCustomer] = useState(Number(promotion?.usage_limit_per_customer ?? 0));
  const [usageLimitPerStore, setUsageLimitPerStore] = useState(Number(promotion?.usage_limit_per_store ?? 0));
  const [effectiveFrom, setEffectiveFrom] = useState((promotion?.effective_from as string) ?? "");
  const [effectiveTo, setEffectiveTo] = useState((promotion?.effective_to as string) ?? "");
  const [eligibleItemIds, setEligibleItemIds] = useState<string[]>((promotion?.eligible_item_ids as string[]) ?? []);
  const [eligibleItemGroupIds, setEligibleItemGroupIds] = useState<string[]>((promotion?.eligible_item_group_ids as string[]) ?? []);
  const [eligibleCustomerIds, setEligibleCustomerIds] = useState<string[]>((promotion?.eligible_customer_ids as string[]) ?? []);

  // searchPosProducts requires a storeId (it also resolves stock
  // availability, irrelevant here but harmless) -- item existence/name/code
  // is company-wide, not store-specific, so any one active store works
  // purely as a search anchor; the admin never sees or picks a store here.
  const storesQuery = useQuery({ queryKey: ["pos", "eligibility-picker-stores"], queryFn: listPosStores });
  const anchorStoreId = storesQuery.data?.rows.find((s) => s.active)?.id;

  const payload = {
    name,
    description: description || undefined,
    discountValue,
    maxDiscountAmount: maxDiscountAmount > 0 ? maxDiscountAmount : null,
    minQuantity: minQuantity > 0 ? minQuantity : null,
    minBasketAmount: minBasketAmount > 0 ? minBasketAmount : null,
    priority,
    stackable,
    exclusive,
    usageLimitTotal: usageLimitTotal > 0 ? usageLimitTotal : null,
    usageLimitPerCustomer: usageLimitPerCustomer > 0 ? usageLimitPerCustomer : null,
    usageLimitPerStore: usageLimitPerStore > 0 ? usageLimitPerStore : null,
    effectiveFrom: effectiveFrom || null,
    effectiveTo: effectiveTo || null,
    eligibleItemIds,
    eligibleItemGroupIds,
    eligibleCustomerIds,
  };

  const mutation = useMutation({
    mutationFn: () => (isEdit ? updatePosPromotion(promotion!.id, payload) : createPosPromotion({ code, discountType, ...payload })),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={isEdit ? `Edit ${promotion!.name}` : "New promotion"}>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        {!isEdit && <TextField label="Code" isRequired value={code} onChange={setCode} />}
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Description" value={description} onChange={setDescription} />
        <div className="grid grid-cols-2 gap-3">
          {!isEdit && (
            <Select
              label="Discount type"
              options={[
                { value: "percent", label: "Percent off" },
                { value: "amount", label: "Amount off" },
              ]}
              selectedKey={discountType}
              onSelectionChange={(key) => setDiscountType(String(key ?? "percent"))}
            />
          )}
          <NumberField label={discountType === "percent" ? "Discount %" : "Discount amount"} value={discountValue} onChange={setDiscountValue} minValue={0} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Max discount amount (0 = no cap)" value={maxDiscountAmount} onChange={setMaxDiscountAmount} minValue={0} />
          <NumberField label="Min quantity (0 = none)" value={minQuantity} onChange={setMinQuantity} minValue={0} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Min basket amount (0 = none)" value={minBasketAmount} onChange={setMinBasketAmount} minValue={0} />
          <NumberField label="Priority (lower runs first)" value={priority} onChange={setPriority} minValue={0} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Total usage limit (0 = unlimited)" value={usageLimitTotal} onChange={setUsageLimitTotal} minValue={0} />
          <NumberField label="Per-customer usage limit (0 = unlimited)" value={usageLimitPerCustomer} onChange={setUsageLimitPerCustomer} minValue={0} />
        </div>
        <NumberField label="Per-store usage limit (0 = unlimited)" value={usageLimitPerStore} onChange={setUsageLimitPerStore} minValue={0} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Effective from (YYYY-MM-DD)" value={effectiveFrom} onChange={setEffectiveFrom} />
          <TextField label="Effective to (YYYY-MM-DD)" value={effectiveTo} onChange={setEffectiveTo} />
        </div>
        <div className="flex gap-4">
          <Checkbox isSelected={stackable} onChange={setStackable}>
            Stackable with other promotions
          </Checkbox>
          <Checkbox isSelected={exclusive} onChange={setExclusive}>
            Exclusive (blocks others)
          </Checkbox>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <p className="text-sm font-medium text-text">Eligibility (blank = every item/customer)</p>
          <EligibilitySearchPicker
            label="Eligible items"
            placeholder="Search items by name, code or barcode…"
            selectedIds={eligibleItemIds}
            onChange={setEligibleItemIds}
            queryKeyPrefix="promotion-items"
            search={async (query) => {
              if (!anchorStoreId || !query.trim()) return [];
              const result = await searchPosProducts(anchorStoreId, query);
              return result.rows.map((row) => ({ id: row.itemId, label: `${row.name} (${row.code})` }));
            }}
          />
          <EligibilitySearchPicker
            label="Eligible item groups"
            placeholder="Search item groups…"
            selectedIds={eligibleItemGroupIds}
            onChange={setEligibleItemGroupIds}
            queryKeyPrefix="promotion-item-groups"
            search={async (query) => {
              if (!query.trim()) return [];
              const result = await searchPosItemGroups(query);
              return result.rows.map((row) => ({ id: row.id, label: `${row.name} (${row.code})` }));
            }}
          />
          <EligibilitySearchPicker
            label="Eligible customers"
            placeholder="Search customers by name, phone or email…"
            selectedIds={eligibleCustomerIds}
            onChange={setEligibleCustomerIds}
            queryKeyPrefix="promotion-customers"
            search={async (query) => {
              if (!query.trim()) return [];
              const result = await searchPosCustomers(query);
              return result.rows.map((row) => ({ id: row.id, label: row.phone || row.email ? `${row.displayName} · ${row.phone || row.email}` : row.displayName }));
            }}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim() || (!isEdit && !code.trim()) || discountValue <= 0}>
            {isEdit ? "Save changes" : "Create promotion"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
