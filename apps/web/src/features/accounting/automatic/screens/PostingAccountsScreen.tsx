"use client";

// Posting accounts: the accounts every automatic posting uses, grouped and described in plain words, each with its health (chosen, missing,
// disabled, of the wrong kind). Changing one applies from today: entries already posted keep their account, and the change is kept in its
// history. Product-, party- and category-specific accounts refine a default (Finance profiles of items). Also the two posting policies:
// input tax credit waits for confirmation, and expenses need a second person's approval.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ComboBox, ErrorState, PageHeader, PermissionState, StatusBadge, Switch } from "@vercentlabs/design-system";

import { act, readView } from "@/features/accounting/shared/client";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, listPostingAccounts, setPostingAccount, type AccountOption, type PostingAccount } from "../api/automatic-api";

const STATE: Record<PostingAccount["state"], { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  ok: { label: "Ready", tone: "success" }, missing: { label: "Not chosen", tone: "danger" }, unusable: { label: "Unusable", tone: "danger" },
  incompatible: { label: "Wrong kind", tone: "warning" }, not_used: { label: "Optional", tone: "neutral" },
};
const GROUPS = ["Sales", "GST", "Purchases", "Inventory", "Cash and bank", "Point of sale", "Other"];

export function PostingAccountsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const mayChange = can("accounting.settings.manage");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "posting-accounts"), queryFn: listPostingAccounts, retry: false });
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "settings"), queryFn: () => readView<{ settings: { settings: Record<string, unknown> | null } }>("settings") });
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const grouped = useMemo(() => GROUPS.map((group) => ({ group, items: (query.data?.items ?? []).filter((item) => item.group === group) })).filter((entry) => entry.items.length), [query.data]);
  if (query.isLoading) return <LoadingState label="Loading posting accounts" rows={10} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load posting accounts" description={errorMessage(query.error)} />;
  }
  const problems = query.data.items.filter((item) => item.state === "missing" || item.state === "unusable" || item.state === "incompatible");
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
  const policy = settings.data?.settings.settings ?? null;
  const savePolicy = async (field: string, value: boolean) => {
    setMessage(null);
    try { await act("settings-save", { [field]: value }); await refresh(); setMessage({ tone: "success", text: "Saved." }); } catch (error) { setMessage({ tone: "danger", text: errorMessage(error) }); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Posting Accounts" description="The accounts automatic postings use. Choose them once; every invoice, bill, payment and stock movement then records itself. A change applies from today and never alters entries already posted." />
      {problems.length > 0 && <Notice tone="danger">{problems.length} posting account(s) need attention. Postings that use them fail until they are chosen.</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {policy && (
        <Panel title="Posting rules">
          <Switch isSelected={policy.itc_requires_confirmation !== false} isDisabled={!mayChange} onChange={(value) => void savePolicy("itcRequiresConfirmation", value)}>
            Input GST waits for confirmation (GSTR-2B) before it is claimable
          </Switch>
          <Switch isSelected={policy.expense_approval_required !== false} isDisabled={!mayChange} onChange={(value) => void savePolicy("expenseApprovalRequired", value)}>
            Expenses need approval by a second person before they post
          </Switch>
        </Panel>
      )}
      {grouped.map(({ group, items }) => (
        <Panel key={group} title={group}>
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => <PostingAccountRow key={item.key} item={item} accounts={query.data.accounts} mayChange={mayChange} onSaved={async (text) => { setMessage({ tone: "success", text }); await refresh(); }}
              onError={(text) => setMessage({ tone: "danger", text })} />)}
          </ul>
        </Panel>
      ))}
      <p className="text-xs text-text-muted">Product-specific sales, purchase, inventory and cost-of-goods-sold accounts are set on an item&apos;s Finance profile; they override these defaults for that item.</p>
    </div>
  );
}

function PostingAccountRow({ item, accounts, mayChange, onSaved, onError }: {
  item: PostingAccount; accounts: AccountOption[]; mayChange: boolean; onSaved: (text: string) => Promise<void>; onError: (text: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(item.account?.id ?? null);
  const [busy, setBusy] = useState(false);
  const state = STATE[item.state];
  const options = accounts.filter((account) => item.classes.includes(account.accountClass)).map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }));
  const save = async () => {
    if (!choice) return;
    setBusy(true);
    try {
      const result = await setPostingAccount(item.key, choice);
      await onSaved(result.changed ? `${item.label} now uses the chosen account from ${formatDate(result.effectiveFrom ?? null)}.` : "Nothing changed.");
    } catch (error) { onError(errorMessage(error)); } finally { setBusy(false); }
  };
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">{item.label}<StatusBadge tone={state.tone}>{state.label}</StatusBadge>
          {item.overrides > 0 && <span className="text-xs font-normal text-text-muted">{item.overrides} specific override(s)</span>}</span>
        <span className="text-xs text-text-muted">{item.purpose}</span>
        {item.problem && <span className="text-xs text-danger">{item.problem}</span>}
        {item.account && <span className="text-xs text-text-secondary">Uses <Link className="text-brand underline" href={`/accounting/ledger/${item.account.id}`}>{item.account.code} · {item.account.name}</Link>
          {item.account.since ? ` since ${formatDate(item.account.since)}` : ""}</span>}
        {item.history.length > 0 && <span className="text-xs text-text-muted">Before: {item.history.map((entry) => `${entry.account}${entry.to ? ` until ${formatDate(entry.to)}` : ""}`).join("; ")}</span>}
      </div>
      {mayChange && (
        <div className="flex items-end gap-2">
          <ComboBox aria-label={`${item.label} account`} size="compact" className="sm:w-72" placeholder="Choose an account" selectedKey={choice} onSelectionChange={(key) => setChoice(key ? String(key) : null)} options={options} />
          <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!choice || choice === item.account?.id} onPress={save}>Save</Button>
        </div>
      )}
    </li>
  );
}
