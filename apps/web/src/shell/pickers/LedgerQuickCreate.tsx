"use client";

// A new ledger from a voucher (Create-Where-You-Are A4), the way accountants used to Tally expect: its name and the group it sits under.
// The class comes from the group, the type is the class's ordinary one (Other current asset, Expense…), and the code is the next free number
// under the group (editable). The Chart of Accounts' own rules and permission apply.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ComboBox, TextField } from "@vercentlabs/design-system";

import { QuickCreateLayout, failure } from "./QuickCreateParts";
import type { PickedRecord, QuickCreateProps } from "./types";

type ChartNode = { id: string; code: string; name: string; accountClass: string; accountType: string; isGroup: boolean; allowManualPosting: boolean; status: string;
  parentId: string | null };

const DEFAULT_TYPE: Record<string, string> = { asset: "current_asset", liability: "current_liability", equity: "equity", revenue: "revenue", expense: "expense" };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message ?? payload?.message ?? "The request could not be completed.");
  return (payload?.data ?? payload) as T;
}

// The chart arrives flat, in tree order.
export const loadChart = async () => (await call<{ chart: { accounts: ChartNode[] } }>("/api/accounting/chart")).chart.accounts;

// Accounts a voucher line may post to, by name or code.
export async function searchLedgers(text: string): Promise<PickedRecord[]> {
  const needle = text.trim().toLowerCase();
  return (await loadChart()).filter((account) => !account.isGroup && account.status === "active" && account.allowManualPosting
    && (!needle || account.name.toLowerCase().includes(needle) || account.code.toLowerCase().includes(needle)))
    .slice(0, 30).map((account) => ({ id: account.id, label: `${account.code} · ${account.name}`, raw: account as unknown as Record<string, unknown> }));
}

// The next free numeric code under a group: one more than the highest numeric code among its accounts, else the group's code with 01.
function nextCode(chart: ChartNode[], group: ChartNode) {
  const taken = new Set(chart.map((account) => account.code));
  const numeric = chart.filter((account) => account.parentId === group.id && /^\d+$/.test(account.code)).map((account) => Number(account.code));
  let candidate = numeric.length ? Math.max(...numeric) + 1 : Number(/^\d+$/.test(group.code) ? `${group.code}01` : NaN);
  if (!Number.isFinite(candidate)) return "";
  while (taken.has(String(candidate))) candidate += 1;
  return String(candidate).slice(0, 20);
}

export function LedgerQuickCreate({ initialText, onCreated, onCancel }: QuickCreateProps) {
  const chart = useQuery({ queryKey: ["quick-create", "chart"], queryFn: loadChart });
  const [name, setName] = useState(initialText.trim());
  const [groupId, setGroupId] = useState("");
  const [code, setCode] = useState("");
  const groups = (chart.data ?? []).filter((account) => account.isGroup && account.status === "active");
  const group = groups.find((entry) => entry.id === groupId);
  const suggested = group && chart.data ? nextCode(chart.data, group) : "";
  const save = useMutation({
    mutationFn: async (): Promise<PickedRecord> => {
      const { account } = await call<{ account: ChartNode }>("/api/accounting/chart", { method: "POST", body: JSON.stringify({
        code: (code.trim() || suggested).toUpperCase(), name: name.trim(), accountClass: group!.accountClass, accountType: DEFAULT_TYPE[group!.accountClass], parentId: group!.id,
      }) });
      return { id: account.id, label: `${account.code} · ${account.name}`, raw: account as unknown as Record<string, unknown> };
    },
    onSuccess: onCreated,
  });
  return (
    <QuickCreateLayout error={save.isError ? failure(save.error) : null} onCancel={onCancel} onSubmit={() => save.mutate()} submitLabel="Create ledger"
      isPending={save.isPending} isDisabled={!name.trim() || !group || !(code.trim() || suggested)}>
      <TextField label="Ledger name" isRequired autoFocus value={name} onChange={setName} placeholder="For example: Courier charges" />
      <ComboBox label="Under group" isRequired selectedKey={groupId || null} onSelectionChange={(key) => setGroupId(String(key ?? ""))} placeholder={chart.isLoading ? "Loading the chart…" : "Search groups"}
        options={groups.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} description="Its class (asset, liability, income, expense) comes from the group." />
      <TextField label="Code" value={code} onChange={(value) => setCode(value.toUpperCase())} placeholder={suggested || "Choose the group first"}
        description={suggested ? `Leave empty to use ${suggested}.` : undefined} />
    </QuickCreateLayout>
  );
}
