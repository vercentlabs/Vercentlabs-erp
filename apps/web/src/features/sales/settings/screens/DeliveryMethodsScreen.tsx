"use client";

// Sales › Setup › Delivery methods (Sales report Phase 3): how goods are sent and what it costs — a fixed amount, per kg of gross weight,
// or a % of the value; free above an amount; limited to some states. A quotation or order with a method gets its freight from it.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, Checkbox, Dialog, ErrorState, NumberField, PageHeader, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { GST_STATES } from "@/features/crm/shared/gst-states";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { patch, post, request } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";

type Method = { id: string; name: string; basis: "fixed" | "per_kg" | "percent"; basisLabel: string; rate: number; minimumCharge: number | null; freeAbove: number | null;
  stateCodes: string[]; active: boolean };

const describe = (method: Method) => [
  method.basis === "fixed" ? money("INR", method.rate) : method.basis === "per_kg" ? `${money("INR", method.rate)} per kg` : `${method.rate}% of the value`,
  method.minimumCharge ? `at least ${money("INR", method.minimumCharge)}` : null,
  method.freeAbove ? `free above ${money("INR", method.freeAbove)}` : null,
  method.stateCodes.length ? `${method.stateCodes.length} ${method.stateCodes.length === 1 ? "state" : "states"}` : "all states",
].filter(Boolean).join(" · ");

export function DeliveryMethodsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.settings.manage");
  const key = scopedQueryKey(workspace, "sales", "delivery-methods", "all");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ methods: Method[] }>("/delivery-methods?includeInactive=1"), enabled: canManage });
  const [editing, setEditing] = useState<Method | "new" | null>(null);
  const toggle = useMutation({ mutationFn: (method: Method) => post(`/delivery-methods/${method.id}`, { active: !method.active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "delivery-methods") }) });
  if (!canManage) return <PermissionState title="You cannot set up delivery methods" description="Ask someone who manages Sales settings." />;
  const methods = query.data?.methods ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Delivery methods" description="How goods are sent and what the freight costs."
        primaryAction={<Button variant="primary" className="flex-1 sm:flex-none" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New delivery method</Button>} />
      {toggle.isError && <Notice tone="danger">{(toggle.error as Error).message}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <section aria-labelledby="methods-list" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <h2 id="methods-list" className="border-b border-border px-4 py-3 text-sm font-semibold text-text">{`${methods.length} ${methods.length === 1 ? "method" : "methods"}`}</h2>
          {query.isLoading ? <div className="p-4"><LoadingState label="Loading" rows={3} /></div>
            : query.isError ? <ErrorState title="Could not load delivery methods" action={{ label: "Try again", onPress: () => void query.refetch() }} />
            : methods.length === 0 ? <p className="px-4 py-6 text-sm text-text-secondary">None yet. Freight is typed on each document until you add one.</p> : (
              <ul className="flex flex-col divide-y divide-border">
                {methods.map((method) => (
                  <li key={method.id} className={`flex items-start gap-3 px-4 py-3.5 ${method.active ? "" : "bg-surface-muted"}`}>
                    <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                      <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{method.name}</span>{!method.active && <StatusBadge tone="neutral">Off</StatusBadge>}</span>
                      <span className="text-xs text-text-secondary">{describe(method)}</span>
                    </div>
                    <div className="shrink-0 sm:hidden">
                      <MoreMenu label={`Actions for ${method.name}`} items={[
                        { id: "edit", label: "Edit", onAction: () => setEditing(method) },
                        { id: "active", label: method.active ? "Switch off" : "Switch on", onAction: () => toggle.mutate(method) },
                      ]} />
                    </div>
                    <div className="hidden shrink-0 items-center gap-1 sm:grid sm:grid-cols-[auto_6.5rem]">
                      <Button variant="ghost" size="compact" aria-label={`Edit ${method.name}`} onPress={() => setEditing(method)}>Edit</Button>
                      <Button variant="ghost" size="compact" isDisabled={toggle.isPending} onPress={() => toggle.mutate(method)}>{method.active ? "Switch off" : "Switch on"}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </section>
        <section aria-labelledby="methods-how" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 id="methods-how" className="text-sm font-semibold text-text">How freight is worked out</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            <li>Choose a method on a quotation or order: its freight charge is added and taxed with the goods.</li>
            <li>Per kg uses each product&apos;s gross weight.</li>
            <li>A method limited to some states cannot be chosen for other ship-to states.</li>
          </ul>
        </section>
      </div>
      {editing && <MethodDialog method={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "delivery-methods") }); }} />}
    </div>
  );
}

function MethodDialog({ method, onClose, onSaved }: { method: Method | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(method?.name ?? "");
  const [basis, setBasis] = useState<Method["basis"]>(method?.basis ?? "fixed");
  const [rate, setRate] = useState(method?.rate ?? 0);
  const [minimum, setMinimum] = useState<number>(method?.minimumCharge ?? Number.NaN);
  const [freeAbove, setFreeAbove] = useState<number>(method?.freeAbove ?? Number.NaN);
  const [everywhere, setEverywhere] = useState(!method?.stateCodes.length);
  const [states, setStates] = useState<string[]>(method?.stateCodes ?? []);
  const input = { name: name.trim(), basis, rate, minimumCharge: Number.isFinite(minimum) ? minimum : null, freeAbove: Number.isFinite(freeAbove) ? freeAbove : null,
    stateCodes: everywhere ? [] : states };
  const save = useMutation({ mutationFn: () => (method ? patch(`/delivery-methods/${method.id}`, input) : post("/delivery-methods", input)), onSuccess: onSaved });
  const ready = Boolean(input.name) && rate >= 0 && (everywhere || states.length > 0);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} size="lg" title={method ? `Edit "${method.name}"` : "New delivery method"} description="What the freight costs with it.">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Name" isRequired autoFocus value={name} onChange={setName} placeholder="For example: Courier, Own truck" />
          <Select label="Charged" selectedKey={basis} onSelectionChange={(key) => setBasis(key === "per_kg" ? "per_kg" : key === "percent" ? "percent" : "fixed")}
            options={[{ value: "fixed", label: "A fixed amount" }, { value: "per_kg", label: "Per kg of gross weight" }, { value: "percent", label: "A % of the goods' value" }]} />
          <NumberField label={basis === "fixed" ? "Amount" : basis === "per_kg" ? "Rate per kg" : "Percentage"} value={rate} onChange={(value) => setRate(Number.isFinite(value) ? value : 0)}
            minValue={0} step={basis === "percent" ? 0.5 : 1} />
          <NumberField label="At least (optional)" value={minimum} onChange={setMinimum} minValue={0} step={1} />
          <NumberField label="Free above an order value (optional)" value={freeAbove} onChange={setFreeAbove} minValue={0} step={100} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-text">Delivers to</legend>
          <Checkbox isSelected={everywhere} onChange={setEverywhere}>Every state</Checkbox>
          {!everywhere && (
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-[var(--radius-control)] border border-border p-2 sm:grid-cols-2">
              {GST_STATES.map((state) => (
                <Checkbox key={state.code} isSelected={states.includes(state.code)}
                  onChange={(on) => setStates((current) => (on ? [...current, state.code] : current.filter((code) => code !== state.code)))}>{`${state.name} (${state.code})`}</Checkbox>
              ))}
            </div>
          )}
        </fieldset>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!ready}>{method ? "Save method" : "Add method"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
