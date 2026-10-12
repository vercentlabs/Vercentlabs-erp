"use client";

// Opening balances: the account balances the business brings from its previous books, as of the go-live date. They are prepared, submitted,
// approved by a second person and posted once; anything that does not balance goes to opening balance equity. Customer and supplier
// balances are entered as opening invoices and bills, and stock as Opening Stock, so they can be collected, paid and issued.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, ComboBox, ErrorState, IconButton, PageHeader, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable, byLine } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { amount, errorMessage, errorStatus, listOpenings, listPostingAccounts, openingAction, plain, saveOpening, type OpeningBalances } from "../api/automatic-api";

const STATUS: Record<OpeningBalances["status"], { label: string; tone: "info" | "success" | "warning" | "danger" }> = {
  DRAFT: { label: "Draft", tone: "info" }, SUBMITTED: { label: "Awaiting approval", tone: "info" }, POSTED: { label: "Posted", tone: "success" },
  REJECTED: { label: "Sent back", tone: "danger" }, REVERSED: { label: "Reversed", tone: "warning" },
};
type Line = { accountId: string | null; debit: string; credit: string };
const blank = (): Line => ({ accountId: null, debit: "", credit: "" });

export function OpeningBalancesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "opening-balances"), queryFn: listOpenings, retry: false });
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "posting-accounts"), queryFn: listPostingAccounts, staleTime: 60_000 });
  const [editing, setEditing] = useState<{ id?: string; asOfDate: string; description: string; lines: Line[] } | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => (accounts.data?.accounts ?? []).filter((account) => !["receivable", "payable", "inventory"].includes(account.accountType))
    .map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` })), [accounts.data]);
  if (list.isLoading) return <LoadingState label="Loading opening balances" rows={6} />;
  if (list.isError || !list.data) {
    if (errorStatus(list.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load opening balances" description={errorMessage(list.error)} />;
  }
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true);
    setMessage(null);
    try { await work(); setReason(""); setMessage({ tone: "success", text }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const totals = editing ? editing.lines.reduce((sum, line) => ({ debit: sum.debit + Number(line.debit || 0), credit: sum.credit + Number(line.credit || 0) }), { debit: 0, credit: 0 }) : null;
  const save = () => run(async () => {
    await saveOpening({ id: editing!.id, asOfDate: editing!.asOfDate, description: editing!.description || undefined,
      lines: editing!.lines.filter((line) => line.accountId).map((line) => ({ accountId: line.accountId, debit: line.debit || "0", credit: line.credit || "0" })) });
    setEditing(null);
  }, "Saved as a draft.");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Opening Balances" description="Balances brought from your previous books. A second person approves them before they post; any difference goes to opening balance equity."
        primaryAction={can("accounting.journal.create") && !editing ? <Button variant="primary" onPress={() => setEditing({ asOfDate: "", description: "", lines: [blank(), blank()] })}>
          <Plus className="size-4" aria-hidden="true" />New opening balances</Button> : undefined} />
      <Notice tone="info">Customer and supplier balances are entered as opening customer invoices and supplier bills, and stock in Inventory › Opening stock, so they can be collected, paid and issued.</Notice>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {editing && totals && (
        <Panel title={editing.id ? "Edit opening balances" : "New opening balances"}>
          <div className="flex flex-wrap gap-2">
            <TextField label="As of" type="date" value={editing.asOfDate} onChange={(value) => setEditing({ ...editing, asOfDate: value })} isRequired />
            <TextField label="Description" value={editing.description} onChange={(value) => setEditing({ ...editing, description: value })} className="sm:min-w-[20rem]" />
          </div>
          {editing.lines.map((line, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              <ComboBox label={`Account ${index + 1}`} size="compact" className="sm:w-80" placeholder="Search accounts" selectedKey={line.accountId} options={options}
                onSelectionChange={(value) => setEditing({ ...editing, lines: editing.lines.map((entry, at) => (at === index ? { ...entry, accountId: value ? String(value) : null } : entry)) })} />
              <TextField label="Debit" size="compact" inputMode="decimal" value={line.debit} className="sm:w-36"
                onChange={(value) => setEditing({ ...editing, lines: editing.lines.map((entry, at) => (at === index ? { ...entry, debit: value, credit: value ? "" : entry.credit } : entry)) })} />
              <TextField label="Credit" size="compact" inputMode="decimal" value={line.credit} className="sm:w-36"
                onChange={(value) => setEditing({ ...editing, lines: editing.lines.map((entry, at) => (at === index ? { ...entry, credit: value, debit: value ? "" : entry.debit } : entry)) })} />
              <IconButton aria-label="Remove line" variant="ghost" size="compact" onPress={() => setEditing({ ...editing, lines: editing.lines.filter((_, at) => at !== index) })}><Trash2 className="size-4" /></IconButton>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="compact" variant="ghost" onPress={() => setEditing({ ...editing, lines: [...editing.lines, blank()] })}><Plus className="size-4" aria-hidden="true" />Add account</Button>
            <span className="text-sm text-text-secondary">Debits {amount(totals.debit)} · Credits {amount(totals.credit)}{Math.abs(totals.debit - totals.credit) > 0.004
              ? ` · ${amount(Math.abs(totals.debit - totals.credit))} goes to opening balance equity` : " · balanced"}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" isLoading={busy} isDisabled={!editing.asOfDate || !editing.lines.some((line) => line.accountId)} onPress={save}>Save draft</Button>
          </div>
        </Panel>
      )}
      {list.data.length === 0 && !editing && <p className="text-sm text-text-muted">No opening balances yet.</p>}
      {list.data.map((opening) => (
        <Panel key={opening.id} title={`${opening.number} · as of ${formatDate(opening.asOfDate)}`} description={opening.description}
          actions={<StatusBadge tone={STATUS[opening.status].tone}>{STATUS[opening.status].label}</StatusBadge>}>
          <FactList columns={3} items={[
            ["Debits", amount(opening.totalDebit)], ["Credits", amount(opening.totalCredit)], ["To opening balance equity", amount(Math.abs(Number(opening.balancingAmount)))],
            ["Prepared", byLine(opening.createdAt, opening.createdBy) ?? "—"], ["Submitted", byLine(opening.submittedAt, opening.submittedBy) ?? "—"], ["Approved", byLine(opening.approvedAt, opening.approvedBy) ?? "—"],
          ]} />
          {opening.rejectionReason && opening.status === "REJECTED" && <Notice tone="warning">Sent back: {opening.rejectionReason}</Notice>}
          <LinesTable columns={["Account", { label: "Debit", numeric: true }, { label: "Credit", numeric: true }]}>
            {opening.lines.map((line) => <tr key={line.accountId}><Cell>{line.account}</Cell><Cell numeric>{plain(line.debit)}</Cell><Cell numeric>{plain(line.credit)}</Cell></tr>)}
          </LinesTable>
          <div className="flex flex-wrap items-end gap-2">
            {opening.journalEntryId && <Link className="text-sm text-brand underline" href={`/accounting/journals/${opening.journalEntryId}`}>Journal {opening.journalNumber}</Link>}
            {["DRAFT", "REJECTED"].includes(opening.status) && can("accounting.journal.create") && <Button size="compact" variant="secondary"
              onPress={() => setEditing({ id: opening.id, asOfDate: opening.asOfDate, description: opening.description, lines: opening.lines.map((line) => ({ accountId: line.accountId, debit: Number(line.debit) ? String(Number(line.debit)) : "", credit: Number(line.credit) ? String(Number(line.credit)) : "" })) })}>Edit</Button>}
            {["DRAFT", "REJECTED"].includes(opening.status) && can("accounting.journal.submit") && <Button size="compact" variant="primary" isLoading={busy}
              onPress={() => run(() => openingAction(opening.id, "submit"), "Submitted for approval.")}>Submit for approval</Button>}
            {opening.status === "SUBMITTED" && opening.canApprove && <Button size="compact" variant="primary" isLoading={busy}
              onPress={() => run(() => openingAction(opening.id, "approve"), "Approved and posted.")}>Approve and post</Button>}
            {opening.status === "SUBMITTED" && !opening.canApprove && <span className="text-sm text-text-muted">Waiting for someone else to approve.</span>}
            {((opening.status === "SUBMITTED" && opening.canApprove) || (opening.status === "POSTED" && can("accounting.journal.reverse"))) && (
              <>
                <TextField label="Reason" size="compact" value={reason} onChange={setReason} maxLength={500} />
                <Button size="compact" variant="secondary" isLoading={busy} isDisabled={reason.trim().length < 3}
                  onPress={() => run(() => openingAction(opening.id, opening.status === "SUBMITTED" ? "reject" : "reverse", reason.trim()), opening.status === "SUBMITTED" ? "Sent back." : "Reversed.")}>
                  {opening.status === "SUBMITTED" ? "Send back" : "Reverse"}</Button>
              </>
            )}
          </div>
        </Panel>
      ))}
    </div>
  );
}
