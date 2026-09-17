"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Power } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, IconButton, NumberField, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosCoupon } from "@vercentlabs/api";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { createPosCoupon, listPosCoupons, PosApiError, setPosCouponActive, updatePosCoupon } from "@/features/pos/shared/pos-api";

// F281 -- real coupon administration against the F281 backend built in
// session 2 (features/coupons.js). Committed redemption facts
// (committed_count) are shown read-only and never editable here -- this
// screen only edits the coupon's own configuration. Item/customer ID-
// array eligibility has the same disclosed gap as promotions (no item/
// customer picker exists yet).
export function PosCouponsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.settingsManage);

  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PosCoupon | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "coupons", statusFilter),
    queryFn: () => listPosCoupons(statusFilter === "all" ? undefined : statusFilter),
    enabled: canManage,
  });
  const rows = query.data?.rows ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "coupons") });
  }
  function handleError(err: unknown) {
    setError(err instanceof PosApiError ? err.message : "This action could not be completed.");
  }

  const toggleActiveMutation = useMutation({
    mutationFn: (coupon: PosCoupon) => setPosCouponActive(coupon.id, coupon.status !== "active"),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const columns: ColumnDef<PosCoupon, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code", cell: ({ row }) => <span className="font-mono font-medium text-text">{row.original.code}</span> },
      { id: "name", header: "Name", accessorFn: (row) => row.name ?? "—" },
      { id: "discount", header: "Discount", accessorFn: (row) => (row.discount_type === "percent" ? `${row.discount_value}%` : row.discount_value) },
      { id: "redemptions", header: "Redemptions", accessorFn: (row) => `${row.committed_count ?? 0}${row.usage_limit_total ? ` / ${row.usage_limit_total}` : ""}` },
      { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status}</StatusBadge> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <span onClick={(event) => event.stopPropagation()}>
            <IconButton
              aria-label={row.original.status === "active" ? `Deactivate ${row.original.code}` : `Activate ${row.original.code}`}
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

  if (!canManage) return <PermissionState title="You don't have access to Coupon settings" description="Ask an administrator to grant pos.settings.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Coupons",
          description: "Codes a cashier or customer can apply at checkout for a discount.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New coupon
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
        <EnterpriseDataGrid<PosCoupon>
          aria-label="Coupons"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
          onRowClick={(row) => setEditing(row)}
        />
      </EnterpriseListPage>

      <CouponFormDialog isOpen={createOpen} onOpenChange={setCreateOpen} onSaved={invalidate} onError={handleError} />
      {editing && (
        <CouponFormDialog
          isOpen
          coupon={editing}
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

function CouponFormDialog({
  isOpen,
  onOpenChange,
  coupon,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  coupon?: PosCoupon;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const isEdit = Boolean(coupon);
  const [code, setCode] = useState(coupon?.code ?? "");
  const [name, setName] = useState((coupon?.name as string) ?? "");
  const [discountType, setDiscountType] = useState<string>((coupon?.discount_type as string) ?? "amount");
  const [discountValue, setDiscountValue] = useState(Number(coupon?.discount_value ?? 5));
  const [maxDiscountAmount, setMaxDiscountAmount] = useState(Number(coupon?.max_discount_amount ?? 0));
  const [minBasketAmount, setMinBasketAmount] = useState(Number(coupon?.min_basket_amount ?? 0));
  const [usageLimitTotal, setUsageLimitTotal] = useState(Number(coupon?.usage_limit_total ?? 0));
  const [usageLimitPerCustomer, setUsageLimitPerCustomer] = useState(Number(coupon?.usage_limit_per_customer ?? 0));
  const [effectiveFrom, setEffectiveFrom] = useState((coupon?.effective_from as string) ?? "");
  const [effectiveTo, setEffectiveTo] = useState((coupon?.effective_to as string) ?? "");

  const payload = {
    name: name || undefined,
    maxDiscountAmount: maxDiscountAmount > 0 ? maxDiscountAmount : null,
    minBasketAmount: minBasketAmount > 0 ? minBasketAmount : null,
    usageLimitTotal: usageLimitTotal > 0 ? usageLimitTotal : null,
    usageLimitPerCustomer: usageLimitPerCustomer > 0 ? usageLimitPerCustomer : null,
    effectiveFrom: effectiveFrom || null,
    effectiveTo: effectiveTo || null,
    ...(isEdit ? { discountValue } : {}),
  };

  const mutation = useMutation({
    mutationFn: () => (isEdit ? updatePosCoupon(coupon!.id, payload) : createPosCoupon({ code, discountType, discountValue, ...payload })),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={isEdit ? `Edit ${coupon!.code}` : "New coupon"}>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        {!isEdit && <TextField label="Code" isRequired value={code} onChange={(v) => setCode(v.toUpperCase())} />}
        <TextField label="Name (optional)" value={name} onChange={setName} />
        <div className="grid grid-cols-2 gap-3">
          {!isEdit && (
            <Select
              label="Discount type"
              options={[
                { value: "amount", label: "Amount off" },
                { value: "percent", label: "Percent off" },
              ]}
              selectedKey={discountType}
              onSelectionChange={(key) => setDiscountType(String(key ?? "amount"))}
            />
          )}
          <NumberField label={discountType === "percent" ? "Discount %" : "Discount amount"} value={discountValue} onChange={setDiscountValue} minValue={0} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Max discount amount (0 = no cap)" value={maxDiscountAmount} onChange={setMaxDiscountAmount} minValue={0} />
          <NumberField label="Min basket amount (0 = none)" value={minBasketAmount} onChange={setMinBasketAmount} minValue={0} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Total usage limit (0 = unlimited)" value={usageLimitTotal} onChange={setUsageLimitTotal} minValue={0} />
          <NumberField label="Per-customer usage limit (0 = unlimited)" value={usageLimitPerCustomer} onChange={setUsageLimitPerCustomer} minValue={0} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Effective from (YYYY-MM-DD)" value={effectiveFrom} onChange={setEffectiveFrom} />
          <TextField label="Effective to (YYYY-MM-DD)" value={effectiveTo} onChange={setEffectiveTo} />
        </div>
        {isEdit && (
          <p className="text-xs text-text-muted">
            {coupon!.committed_count ?? 0} redemption(s) already committed. Historical redemption facts cannot be edited here.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={(!isEdit && !code.trim()) || discountValue <= 0}>
            {isEdit ? "Save changes" : "Create coupon"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
