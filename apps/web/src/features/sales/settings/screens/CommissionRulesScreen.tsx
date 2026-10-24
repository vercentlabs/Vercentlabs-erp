"use client";

// Sales › Setup › Commission Rules (Sales audit): commission accrues when an order is confirmed, from the rule that applies — a rate on net
// sales or on margin, for one salesperson or everyone, between dates. A salesperson's own rule wins over everyone's.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, ErrorState, NumberField, PageHeader, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { Panel } from "@/shared/ui/Panel";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { post, request, SalesApiError } from "@/features/sales/shared/http";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";

type Rule = { id: string; name: string; ownerUserId: string | null; ownerName: string | null; ratePercent: number; basis: "net_sales" | "gross_margin"; basisLabel: string;
  validFrom: string | null; validTo: string | null; isActive: boolean; entries: number };
const EVERYONE = "everyone";

export function CommissionRulesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "commission-rules");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ rules: Rule[]; canManage: boolean }>("/commission-rules") });
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const toggle = useMutation({
    mutationFn: (rule: Rule) => post(`/commission-rules/${rule.id}`, { active: !rule.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Commission Rules" description="Commission is earned when an order is confirmed. A salesperson's own rule comes before the general one."
        primaryAction={data?.canManage ? <Button variant="primary" onPress={() => setEditing("new")}>New rule</Button> : undefined} />
      {query.isLoading && <LoadingState label="Loading commission rules" rows={4} />}
      {query.isError && <ErrorState title="Could not load commission rules" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
      {data && (
        <Panel title="Rules">
          {data.rules.length === 0 ? <p className="text-sm text-text-muted">No rules yet: no commission accrues.</p> : (
            <ul className="flex flex-col divide-y divide-border">
              {data.rules.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex flex-col">
                    <span className="font-medium">{rule.name} <StatusBadge tone={rule.isActive ? "success" : "neutral"}>{rule.isActive ? "Active" : "Off"}</StatusBadge></span>
                    <span className="text-xs text-text-muted">
                      {rule.ratePercent}% of {rule.basisLabel.toLowerCase()} · {rule.ownerName ?? "Everyone"}
                      {rule.validFrom || rule.validTo ? ` · ${rule.validFrom ?? "…"} to ${rule.validTo ?? "…"}` : ""} · {rule.entries} earned
                    </span>
                  </span>
                  {data.canManage && (
                    <span className="flex gap-2">
                      <Button variant="ghost" size="compact" onPress={() => setEditing(rule)}>Edit</Button>
                      <Button variant="ghost" size="compact" onPress={() => toggle.mutate(rule)}>{rule.isActive ? "Switch off" : "Switch on"}</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {editing && <RuleDialog rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: key }); }} />}
    </div>
  );
}

function RuleDialog({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  const workspace = useWorkspaceContext();
  const users = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options", "commission"), queryFn: () => getSalesOptions().then((r) => r.options.users), staleTime: 60_000 });
  const [name, setName] = useState(rule?.name ?? "");
  const [rate, setRate] = useState(rule?.ratePercent ?? NaN);
  const [basis, setBasis] = useState<string>(rule?.basis ?? "net_sales");
  const [owner, setOwner] = useState(rule?.ownerUserId ?? EVERYONE);
  const [from, setFrom] = useState(rule?.validFrom ?? "");
  const [to, setTo] = useState(rule?.validTo ?? "");
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), ratePercent: rate, basis, ownerUserId: owner === EVERYONE ? null : owner, validFrom: from || null, validTo: to || null };
      return rule ? request(`/commission-rules/${rule.id}`, { method: "PATCH", body: JSON.stringify(body) }) : post("/commission-rules", body);
    },
    onSuccess: onSaved,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={rule ? `Edit ${rule.name}` : "New commission rule"} size="md">
      <div className="flex flex-col gap-4">
        {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof SalesApiError ? save.error.message : "The rule could not be saved."}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField className="sm:col-span-2" label="Name" isRequired value={name} onChange={setName} />
          <NumberField label="Rate (%)" isRequired value={rate} onChange={setRate} minValue={0} maxValue={100} step={0.25} />
          <Select label="On" selectedKey={basis} onSelectionChange={(key) => setBasis(String(key))}
            options={[{ value: "net_sales", label: "Net sales (before tax)" }, { value: "gross_margin", label: "Margin" }]} />
          <Select className="sm:col-span-2" label="For" selectedKey={owner} onSelectionChange={(key) => setOwner(String(key))}
            options={[{ value: EVERYONE, label: "Every salesperson" }, ...(users.data ?? []).map((user) => ({ value: user.id, label: user.full_name }))]} />
          <TextField label="From" type="date" value={from} onChange={setFrom} />
          <TextField label="Until" type="date" value={to} onChange={setTo} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!name.trim() || !Number.isFinite(rate)} onPress={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
