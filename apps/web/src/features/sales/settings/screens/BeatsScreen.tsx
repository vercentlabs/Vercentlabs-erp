"use client";

// Sales › Masters › Beats (Sales plan, Phase 4): the rounds salespeople make — the retailers of one area, visited on given weekdays. Each
// beat shows its customers and what they ordered this month; its customers and orders open filtered by it. Today shows only the beats
// visited today.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, ErrorState, PageHeader, Select, Switch, TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Notice, Panel } from "@/shared/ui/Panel";
import { SalesApiError, post, request } from "@/features/sales/shared/http";
import { compactMoney } from "@/features/sales/shared/format";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";

type Beat = { id: string; code: string; name: string; salespersonUserId: string | null; salespersonName: string | null; visitDays: number[]; status: "active" | "inactive";
  customers: number; orderedThisMonth: number | null; ordersThisMonth: number };
const DAYS = [{ day: 1, label: "Mon" }, { day: 2, label: "Tue" }, { day: 3, label: "Wed" }, { day: 4, label: "Thu" }, { day: 5, label: "Fri" }, { day: 6, label: "Sat" }, { day: 7, label: "Sun" }];

export function BeatsScreen() {
  const workspace = useWorkspaceContext();
  const [today, setToday] = useState(false);
  const [editing, setEditing] = useState<Beat | "new" | null>(null);
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.settings.manage");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "beats", today ? "today" : "all"),
    queryFn: () => request<{ routes: Beat[] }>(`/routes?status=all${today ? "&today=true" : ""}`).then((r) => r.routes) });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Beats" description="The rounds salespeople make: the customers of one area, visited on the same weekdays. Put a customer on a beat from the customer's page."
        primaryAction={canManage ? <Button variant="primary" onPress={() => setEditing("new")}>New beat</Button> : undefined} />
      <Switch isSelected={today} onChange={setToday}>Only today&apos;s beats</Switch>
      {query.isError ? <ErrorState title="Could not load the beats" action={{ label: "Try again", onPress: () => void query.refetch() }} /> : (
        <Panel>
          <LinesTable columns={["Beat", "Salesperson", "Visited on", { label: "Customers", numeric: true }, { label: "Orders this month", numeric: true }, { label: "Ordered", numeric: true }, ""]}
            empty={query.isLoading ? "Loading…" : query.data?.length ? undefined : today ? "No beat is visited today." : "No beats yet."}>
            {(query.data ?? []).map((beat) => (
              <tr key={beat.id} className={beat.status === "inactive" ? "text-text-muted" : undefined}>
                <Cell><span className="font-medium">{beat.name}</span> <span className="text-xs text-text-muted">{beat.code}{beat.status === "inactive" ? " · inactive" : ""}</span></Cell>
                <Cell>{beat.salespersonName ?? "—"}</Cell>
                <Cell>{beat.visitDays.map((day) => DAYS[day - 1]?.label).join(", ") || "—"}</Cell>
                <Cell numeric><Link className="text-brand hover:underline" href={`/sales/customers?f.salesRouteId=${beat.id}`}>{beat.customers}</Link></Cell>
                <Cell numeric><Link className="text-brand hover:underline" href={`/sales/orders?f.salesRouteId=${beat.id}`}>{beat.ordersThisMonth}</Link></Cell>
                <Cell numeric>{beat.orderedThisMonth ? compactMoney("INR", beat.orderedThisMonth) : "—"}</Cell>
                <Cell>{canManage && <Button variant="ghost" size="compact" onPress={() => setEditing(beat)}>Edit</Button>}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {editing && <BeatDialog beat={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BeatDialog({ beat, onClose }: { beat: Beat | null; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options), staleTime: 60_000 });
  const [code, setCode] = useState(beat?.code ?? "");
  const [name, setName] = useState(beat?.name ?? "");
  const [salesperson, setSalesperson] = useState(beat?.salespersonUserId ?? "none");
  const [days, setDays] = useState<number[]>(beat?.visitDays ?? []);
  const [active, setActive] = useState(beat ? beat.status === "active" : true);
  const save = useMutation({
    mutationFn: () => {
      const body = { code, name, salespersonUserId: salesperson === "none" ? null : salesperson, visitDays: days, status: active ? "active" : "inactive" };
      return beat ? request(`/routes/${beat.id}`, { method: "PUT", body: JSON.stringify(body) }) : post("/routes", body);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "beats") }); onClose(); },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={beat ? `Edit ${beat.name}` : "New beat"} size="md">
      <div className="flex flex-col gap-4">
        {save.isError && <Notice tone="danger">{save.error instanceof SalesApiError ? save.error.message : "The beat could not be saved."}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Code" isRequired value={code} onChange={setCode} placeholder="PUNE-E" />
          <TextField label="Name" isRequired value={name} onChange={setName} placeholder="Pune East" />
          <Select className="sm:col-span-2" label="Salesperson" selectedKey={salesperson} onSelectionChange={(key) => setSalesperson(String(key))}
            options={[{ value: "none", label: "None" }, ...(options.data?.users ?? []).map((user) => ({ value: user.id, label: user.full_name }))]} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Visited on</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((entry) => (
              <Checkbox key={entry.day} isSelected={days.includes(entry.day)}
                onChange={(on) => setDays((current) => (on ? [...current, entry.day].sort() : current.filter((day) => day !== entry.day)))}>{entry.label}</Checkbox>
            ))}
          </div>
        </fieldset>
        <Switch isSelected={active} onChange={setActive}>Active</Switch>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!code.trim() || !name.trim() || save.isPending} onPress={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
