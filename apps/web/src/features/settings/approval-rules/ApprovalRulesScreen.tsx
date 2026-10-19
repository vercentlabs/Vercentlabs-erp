"use client";

// Settings › Approval rules (Shared Platform plan 6): "purchase orders of ₹1,00,000 or more need the Purchase Manager; of ₹10,00,000 or
// more, the owner as well". Each rule: the documents, the amount it starts at, the level (1, or 2 after level 1) and the approver —
// a member, or anyone with a role. For a document, each level uses the rule with the highest amount it reaches.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, Dialog, EmptyState, ErrorState, PageHeader, Select, StatusBadge, Switch, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";

type Rule = { id: string; documentType: string; name: string; minAmount: string; level: number; approverUserId: string | null; approverRoleId: string | null; approverName: string | null; active: boolean };
type Payload = { rules: Rule[]; documents: Array<{ key: string; label: string; description: string }>; roles: Array<{ id: string; name: string }> };
type Draft = { id?: string; documentType: string; name: string; minAmount: string; level: number; approver: string; active: boolean };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "That did not work.");
  return payload as T;
}
const KEY = ["settings", "approval-rules"];
const rupees = (value: string) => `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function ApprovalRulesScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => call<Payload>("/api/settings/approval-rules") });
  const people = useQuery({ queryKey: ["people"], queryFn: () => call<{ people: Array<{ id: string; name: string }> }>("/api/people").then((data) => data.people) });
  const [editing, setEditing] = useState<Draft | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const remove = useMutation({ mutationFn: (id: string) => call(`/api/settings/approval-rules/${id}`, { method: "DELETE" }), onSuccess: refresh });
  if (query.isLoading) return <LoadingState label="Loading approval rules" rows={4} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load approval rules" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const { rules, documents, roles } = query.data;
  const blank = (): Draft => ({ documentType: documents[0]?.key ?? "", name: "", minAmount: "0", level: 1, approver: "", active: true });
  const approvers = [
    ...(people.data ?? []).map((person) => ({ value: `user:${person.id}`, label: person.name })),
    ...roles.map((role) => ({ value: `role:${role.id}`, label: `Anyone with the role ${role.name}` })),
  ];
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title="Approval rules" description="Which documents need approval before they go ahead, from what amount, and by whom."
        primaryAction={<Button variant="primary" onPress={() => setEditing(blank())}><Plus className="size-4" aria-hidden="true" />New rule</Button>} />
      {remove.error && <Notice>{(remove.error as Error).message}</Notice>}
      {documents.map((document) => {
        const list = rules.filter((rule) => rule.documentType === document.key);
        return (
          <Panel key={document.key} title={document.label} description={document.description}>
            {list.length === 0 ? <EmptyState title="No rules" description="These documents go ahead without approval." /> : (
              <ul className="flex flex-col divide-y divide-border text-sm">
                {list.map((rule) => (
                  <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <button type="button" className="min-w-0 text-left" onClick={() => setEditing({ id: rule.id, documentType: rule.documentType, name: rule.name, minAmount: rule.minAmount, level: rule.level,
                      approver: rule.approverUserId ? `user:${rule.approverUserId}` : `role:${rule.approverRoleId}`, active: rule.active })}>
                      <span className="font-medium">{rule.name}</span>
                      <span className="block text-text-muted">Level {rule.level} · from {rupees(rule.minAmount)} · {rule.approverName ?? "—"}</span>
                    </button>
                    <span className="flex items-center gap-2">
                      {!rule.active && <StatusBadge tone="neutral">Off</StatusBadge>}
                      <Button variant="ghost" size="compact" aria-label={`Delete ${rule.name}`} onPress={() => remove.mutate(rule.id)}><Trash2 className="size-4" aria-hidden="true" /></Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}
      {editing && <RuleDialog draft={editing} documents={documents} approvers={approvers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function RuleDialog({ draft, documents, approvers, onClose, onSaved }: {
  draft: Draft; documents: Payload["documents"]; approvers: Array<{ value: string; label: string }>; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState(draft);
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = useMutation({
    mutationFn: () => {
      const [kind, id] = form.approver.split(":");
      const body = JSON.stringify({ documentType: form.documentType, name: form.name, minAmount: form.minAmount, level: form.level, active: form.active,
        approverUserId: kind === "user" ? id : null, approverRoleId: kind === "role" ? id : null });
      return call(form.id ? `/api/settings/approval-rules/${form.id}` : "/api/settings/approval-rules", { method: form.id ? "PUT" : "POST", body });
    },
    onSuccess: onSaved,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={form.id ? "Edit approval rule" : "New approval rule"}>
      <div className="flex flex-col gap-3">
        {save.error && <Notice>{(save.error as Error).message}</Notice>}
        <Select label="Documents" selectedKey={form.documentType} onSelectionChange={(key) => set("documentType")(String(key))} options={documents.map((entry) => ({ value: entry.key, label: entry.label }))} />
        <TextField label="Name" isRequired value={form.name} onChange={set("name")} placeholder="For example: Large purchases" />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="From amount (₹)" inputMode="decimal" value={form.minAmount} onChange={set("minAmount")} description="0 means every document." />
          <Select label="Level" selectedKey={String(form.level)} onSelectionChange={(key) => set("level")(Number(key))}
            options={[{ value: "1", label: "Level 1 (first)" }, { value: "2", label: "Level 2 (after level 1)" }]} />
        </div>
        <Select label="Approver" selectedKey={form.approver || null} onSelectionChange={(key) => set("approver")(String(key))} options={approvers} />
        <Switch isSelected={form.active} onChange={set("active")}>Rule is on</Switch>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!form.name.trim() || !form.approver} onPress={() => save.mutate()}>Save rule</Button>
        </div>
      </div>
    </Dialog>
  );
}
