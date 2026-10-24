"use client";

// Sales › Prices & Offers › Coupons (Sales report Phase 3): codes worth an amount or a percentage off a quotation or order, with a minimum
// order, dates, a cap and use limits. A use is an order carrying the code that is not cancelled.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, Dialog, ErrorState, NumberField, PageHeader, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { patch, post, request } from "@/features/sales/shared/http";
import { calendarDate, money } from "@/features/sales/shared/format";

type Coupon = { id: string; code: string; description: string | null; discountType: "amount" | "percent"; value: number; maximumDiscount: number | null;
  minimumOrder: number | null; validFrom: string | null; validTo: string | null; usesTotal: number | null; usesPerCustomer: number | null; used?: number; active: boolean };

const worth = (coupon: Coupon) => (coupon.discountType === "amount" ? `${money("INR", coupon.value)} off` : `${coupon.value}% off${coupon.maximumDiscount ? `, up to ${money("INR", coupon.maximumDiscount)}` : ""}`);
const terms = (coupon: Coupon) => [
  coupon.minimumOrder ? `orders of ${money("INR", coupon.minimumOrder)} or more` : null,
  coupon.validFrom || coupon.validTo ? `${coupon.validFrom ? `from ${calendarDate(coupon.validFrom)}` : ""}${coupon.validFrom && coupon.validTo ? " " : ""}${coupon.validTo ? `until ${calendarDate(coupon.validTo)}` : ""}` : null,
  coupon.usesPerCustomer ? `${coupon.usesPerCustomer} per customer` : null,
].filter(Boolean).join(" · ");
const uses = (coupon: Coupon) => `${coupon.used ?? 0}${coupon.usesTotal ? ` of ${coupon.usesTotal}` : ""} used`;

export function CouponsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.settings.manage");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "coupons"), queryFn: () => request<{ coupons: Coupon[] }>("/coupons?includeInactive=1"), enabled: canManage });
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "coupons") });
  const toggle = useMutation({ mutationFn: (coupon: Coupon) => post(`/coupons/${coupon.id}`, { active: !coupon.active }), onSuccess: refresh });
  if (!canManage) return <PermissionState title="You cannot set up coupons" description="Ask someone who manages Sales settings." />;
  const coupons = query.data?.coupons ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Coupons" description="Codes a customer gives for money off a quotation or order."
        primaryAction={<Button variant="primary" className="flex-1 sm:flex-none" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New coupon</Button>} />
      {toggle.isError && <Notice tone="danger">{(toggle.error as Error).message}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <section aria-labelledby="coupons-list" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <h2 id="coupons-list" className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{`${coupons.length} ${coupons.length === 1 ? "coupon" : "coupons"}`}</h2>
          {query.isLoading ? <div className="p-4"><LoadingState label="Loading" rows={3} /></div>
            : query.isError ? <ErrorState title="Could not load coupons" action={{ label: "Try again", onPress: () => void query.refetch() }} />
            : coupons.length === 0 ? <p className="px-4 py-6 text-sm text-text-secondary">None yet.</p> : (
              <ul className="flex flex-col divide-y divide-border">
                {coupons.map((coupon) => (
                  <li key={coupon.id} className={`flex items-start gap-3 px-4 py-3.5 ${coupon.active ? "" : "bg-surface-muted"}`}>
                    <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-medium">{coupon.code}</span>
                        <span className="text-text-secondary">{worth(coupon)}</span>
                        {!coupon.active && <StatusBadge tone="neutral">Off</StatusBadge>}
                      </span>
                      {coupon.description && <span className="text-xs text-text-secondary">{coupon.description}</span>}
                      <span className="text-xs text-text-muted">{[terms(coupon), uses(coupon)].filter(Boolean).join(" · ")}</span>
                    </div>
                    <div className="shrink-0 sm:hidden">
                      <MoreMenu label={`Actions for ${coupon.code}`} items={[
                        { id: "edit", label: "Edit", onAction: () => setEditing(coupon) },
                        { id: "active", label: coupon.active ? "Switch off" : "Switch on", onAction: () => toggle.mutate(coupon) },
                      ]} />
                    </div>
                    <div className="hidden shrink-0 items-center gap-1 sm:grid sm:grid-cols-[auto_6.5rem]">
                      <Button variant="ghost" size="compact" aria-label={`Edit ${coupon.code}`} onPress={() => setEditing(coupon)}>Edit</Button>
                      <Button variant="ghost" size="compact" isDisabled={toggle.isPending} onPress={() => toggle.mutate(coupon)}>{coupon.active ? "Switch off" : "Switch on"}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </section>
        <section aria-labelledby="coupons-how" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 id="coupons-how" className="text-sm font-semibold text-text">How a coupon works</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            <li>Type the code on a quotation or order. It comes off after the other discounts, before tax.</li>
            <li>It does not count against a salesperson&apos;s discount limit.</li>
            <li>A draft order holds its use; cancelling the order frees it.</li>
            <li>Shop counter coupons are set up in Point of Sale.</li>
          </ul>
        </section>
      </div>
      {editing && <CouponDialog coupon={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

const optional = (value: number) => (Number.isFinite(value) && value > 0 ? value : null);

function CouponDialog({ coupon, onClose, onSaved }: { coupon: Coupon | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(coupon?.code ?? "");
  const [description, setDescription] = useState(coupon?.description ?? "");
  const [discountType, setDiscountType] = useState<Coupon["discountType"]>(coupon?.discountType ?? "percent");
  const [value, setValue] = useState(coupon?.value ?? Number.NaN);
  const [maximumDiscount, setMaximumDiscount] = useState(coupon?.maximumDiscount ?? Number.NaN);
  const [minimumOrder, setMinimumOrder] = useState(coupon?.minimumOrder ?? Number.NaN);
  const [validFrom, setValidFrom] = useState(coupon?.validFrom ?? "");
  const [validTo, setValidTo] = useState(coupon?.validTo ?? "");
  const [usesTotal, setUsesTotal] = useState(coupon?.usesTotal ?? Number.NaN);
  const [usesPerCustomer, setUsesPerCustomer] = useState(coupon?.usesPerCustomer ?? Number.NaN);
  const input = {
    code: code.trim().toUpperCase().replace(/\s+/g, ""), description: description.trim() || null, discountType, value,
    maximumDiscount: discountType === "percent" ? optional(maximumDiscount) : null, minimumOrder: optional(minimumOrder), validFrom: validFrom || null, validTo: validTo || null,
    usesTotal: optional(usesTotal), usesPerCustomer: optional(usesPerCustomer),
  };
  const save = useMutation({ mutationFn: () => (coupon ? patch(`/coupons/${coupon.id}`, input) : post("/coupons", input)), onSuccess: onSaved });
  const ready = /^[A-Z0-9_-]{3,30}$/.test(input.code) && value > 0 && (discountType === "amount" || value <= 100);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} size="lg" title={coupon ? `Edit ${coupon.code}` : "New coupon"} description="What it is worth and when it can be used.">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Code" isRequired autoFocus value={code} onChange={setCode} placeholder="For example: DIWALI10" description="3 to 30 letters or digits." />
          <TextField label="Description (optional)" value={description} onChange={setDescription} placeholder="For example: Diwali offer" />
          <Select label="Worth" selectedKey={discountType} onSelectionChange={(key) => setDiscountType(key === "amount" ? "amount" : "percent")}
            options={[{ value: "percent", label: "A % off" }, { value: "amount", label: "An amount off" }]} />
          <NumberField label={discountType === "percent" ? "Percentage" : "Amount"} isRequired value={value} onChange={setValue} minValue={0}
            maxValue={discountType === "percent" ? 100 : undefined} step={discountType === "percent" ? 1 : 50} />
          {discountType === "percent" && <NumberField label="At most (optional)" value={maximumDiscount} onChange={setMaximumDiscount} minValue={0} step={50} />}
          <NumberField label="Minimum order value (optional)" value={minimumOrder} onChange={setMinimumOrder} minValue={0} step={500} />
          <TextField label="From (optional)" type="date" value={validFrom} onChange={setValidFrom} />
          <TextField label="Until (optional)" type="date" value={validTo} onChange={setValidTo} />
          <NumberField label="Uses in all (optional)" value={usesTotal} onChange={setUsesTotal} minValue={1} step={1} />
          <NumberField label="Uses per customer (optional)" value={usesPerCustomer} onChange={setUsesPerCustomer} minValue={1} step={1} />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!ready}>{coupon ? "Save coupon" : "Add coupon"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
