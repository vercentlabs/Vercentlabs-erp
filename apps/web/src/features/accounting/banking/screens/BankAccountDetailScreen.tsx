"use client";

// One bank or cash account: its balance in the books, how far it is reconciled, its statements (each opens its reconciliation), and — for
// a bank account — importing the next statement. Its details can be edited, the cash handed to another person, and the account closed once
// its balance has been moved out (or reopened).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Breadcrumb, Button, ComboBox, Dialog, ErrorState, LinkButton, PermissionState, RecordDetailsPage, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable, MoreActions } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { BANK_TYPES, STATEMENT_STATUS, bankAccountOptions, errorMessage, errorStatus, getBankAccount, inr, updateBankAccount, type BankCashAccount } from "../api/banking-api";

export function BankAccountDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "bank-account", id), queryFn: () => getBankAccount(id), retry: false });
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [dialog, setDialog] = useState<null | "edit" | "custodian" | "close">(null);
  const mayManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.bank.manage");
  if (query.isLoading) return <LoadingState label="Loading the account" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the account" description={errorMessage(query.error)} />;
  }
  const { account, statements } = query.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") });
  const reopen = async () => {
    setMessage(null);
    try { await updateBankAccount(account.id, { status: "active" }); await refresh(); setMessage({ tone: "success", text: "Account reopened." }); }
    catch (error) { setMessage({ tone: "danger", text: errorMessage(error) }); }
  };
  const active = account.status === "active";

  return (
    <>
      <RecordDetailsPage
        header={{
          breadcrumbs: [<Breadcrumb key="list" href="/accounting/bank-accounts">Bank &amp; cash accounts</Breadcrumb>, <Breadcrumb key="this" isCurrent>{account.name}</Breadcrumb>],
          title: account.name,
          status: <StatusBadge tone={active ? "success" : "neutral"}>{active ? (account.kind === "cash" ? "Cash" : "Bank") : "Closed"}</StatusBadge>,
          fields: [
            { label: "Balance (books)", value: inr(account.balance, account.currency) },
            { label: account.kind === "cash" ? "Held by" : "Bank", value: account.kind === "cash" ? (account.custodian?.name ?? "—") : [account.bankName, account.accountNumber].filter(Boolean).join(" · ") },
            { label: "Reconciled to", value: account.reconciledTo ? formatDate(account.reconciledTo) : "Never" },
          ],
          primaryAction: active && mayManage && account.kind === "bank"
            ? <LinkButton variant="primary" href={`/accounting/reconciliation/import?accountId=${account.id}`}><Upload className="size-4" aria-hidden="true" />Import statement</LinkButton> : undefined,
          secondaryActions: <MoreActions actions={[
            { id: "ledger", label: "Open its ledger", run: () => router.push(`/accounting/ledger/${account.ledgerAccount.id}`) },
            { id: "transfer", label: "Transfer money", run: () => router.push("/accounting/fund-transfers"), show: active && mayManage },
            { id: "edit", label: "Edit details", run: () => setDialog("edit"), show: mayManage },
            { id: "custodian", label: "Hand over the cash", run: () => setDialog("custodian"), show: active && mayManage && account.kind === "cash" },
            { id: "close", label: "Close account", run: () => setDialog("close"), show: active && mayManage },
            { id: "reopen", label: "Reopen account", run: () => void reopen(), show: !active && mayManage },
          ]} />,
        }}
      >
        <div className="flex flex-col gap-4">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          {!active && <Notice tone="neutral">Closed. It is kept with its history; nothing new can be recorded against it until it is reopened.</Notice>}
          {account.linesToReconcile > 0 && <Notice tone="warning">{account.linesToReconcile} statement line{account.linesToReconcile === 1 ? " is" : "s are"} still to reconcile.</Notice>}
          <FactList items={[
            ["Kind", account.kind === "cash" ? "Cash" : BANK_TYPES.find(([value]) => value === account.type)?.[1] ?? account.type],
            ...(account.kind === "bank" ? [["Bank", account.bankName ?? "—"], ["Account number", account.accountNumber ?? "—"], ["IFSC", account.ifsc ?? "—"]] as Array<[string, string]> : []),
            ["Person responsible", account.custodian?.name ?? "—"],
            ["Ledger account", <Link key="l" className="text-brand underline" href={`/accounting/ledger/${account.ledgerAccount.id}`}>{account.ledgerAccount.label}</Link>],
            ["Currency", account.currency], ["Notes", account.notes ?? "—"],
          ]} />
          {account.kind === "cash" && statements.length === 0 ? (
            <Notice tone="neutral">A cash account has no bank statement. Count the cash regularly and compare it with the balance above; record any difference as an expense or a correction.</Notice>
          ) : (
          <Panel title="Statements" description="Each imported statement and how far it is reconciled.">
            <LinesTable columns={["Statement", "Period", { label: "Closing", numeric: true }, "Progress", "Status"]} empty={statements.length ? undefined : "No statement imported yet."}>
              {statements.map((statement) => (
                <tr key={statement.id}>
                  <Cell><Link className="text-brand underline" href={`/accounting/reconciliation/${statement.id}`}>{statement.number}</Link>
                    {statement.fileName && <span className="block text-xs text-text-muted">{statement.fileName}</span>}</Cell>
                  <Cell>{formatDate(statement.from)} – {formatDate(statement.to)}</Cell>
                  <Cell numeric>{inr(statement.closing, account.currency)}</Cell>
                  <Cell>{statement.settled} of {statement.lines} settled{statement.exceptions ? <span className="block text-xs text-danger">{statement.exceptions} exception{statement.exceptions === 1 ? "" : "s"}</span> : null}</Cell>
                  <Cell><StatusBadge tone={STATEMENT_STATUS[statement.status].tone}>{STATEMENT_STATUS[statement.status].label}</StatusBadge></Cell>
                </tr>
              ))}
            </LinesTable>
          </Panel>
          )}
        </div>
      </RecordDetailsPage>
      {dialog === "edit" && <EditDialog account={account} onClose={() => setDialog(null)} onDone={async () => { await refresh(); setDialog(null); setMessage({ tone: "success", text: "Saved." }); }} />}
      {dialog === "custodian" && <CustodianDialog account={account} onClose={() => setDialog(null)} onDone={async () => { await refresh(); setDialog(null); setMessage({ tone: "success", text: "Cash handed over." }); }} />}
      {dialog === "close" && (
        <Dialog isOpen onOpenChange={(open) => !open && setDialog(null)} title={`Close ${account.name}`}
          description={Math.abs(account.balance) >= 0.005 ? `It still holds ${inr(account.balance, account.currency)}. Transfer the balance to another account first.` : "Nothing new can be recorded against it; its history is kept. It can be reopened."}>
          <CloseBody account={account} onClose={() => setDialog(null)} onDone={async () => { await refresh(); setDialog(null); setMessage({ tone: "success", text: "Account closed." }); }} />
        </Dialog>
      )}
    </>
  );
}

function CloseBody({ account, onClose, onDone }: { account: BankCashAccount; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const holds = Math.abs(account.balance) >= 0.005;
  return (
    <div className="flex flex-col gap-3">
      {failure && <Notice>{failure}</Notice>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={onClose}>{holds ? "OK" : "Cancel"}</Button>
        {!holds && <Button variant="danger" isLoading={busy} onPress={async () => {
          setBusy(true); setFailure(null);
          try { await updateBankAccount(account.id, { status: "inactive" }); await onDone(); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); }
        }}>Close account</Button>}
      </div>
    </div>
  );
}

function EditDialog({ account, onClose, onDone }: { account: BankCashAccount; onClose: () => void; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ name: account.name, bankName: account.bankName ?? "", accountNumber: "", ifsc: account.ifsc ?? "", notes: account.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const ifscBad = account.kind === "bank" && form.ifsc.trim() !== "" && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc.trim().toUpperCase());
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Edit ${account.name}`}>
      <div className="flex flex-col gap-3">
        {failure && <Notice>{failure}</Notice>}
        <TextField label="Name" isRequired value={form.name} onChange={set("name")} maxLength={200} />
        {account.kind === "bank" && <>
          <TextField label="Bank" value={form.bankName} onChange={set("bankName")} maxLength={200} />
          <TextField label="New account number" inputMode="numeric" value={form.accountNumber} onChange={set("accountNumber")} maxLength={40}
            description={`Now ${account.accountNumber ?? "not recorded"}. Leave empty to keep it.`} />
          <TextField label="IFSC" value={form.ifsc} onChange={(value) => set("ifsc")(value.toUpperCase())} maxLength={11} errorMessage={ifscBad ? "An IFSC is 11 characters, like HDFC0001234" : undefined} />
        </>}
        <TextArea label="Notes" value={form.notes} onChange={set("notes")} maxLength={2000} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!form.name.trim() || ifscBad || busy} onPress={async () => {
            setBusy(true); setFailure(null);
            try {
              await updateBankAccount(account.id, {
                name: form.name.trim(), notes: form.notes.trim() || null,
                ...(account.kind === "bank" ? { bankName: form.bankName.trim() || undefined, ifsc: form.ifsc.trim() || null, ...(form.accountNumber.trim() ? { accountNumber: form.accountNumber.trim() } : {}) } : {}),
              });
              await onDone();
            } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); }
          }}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

function CustodianDialog({ account, onClose, onDone }: { account: BankCashAccount; onClose: () => void; onDone: () => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "bank-account-options"), queryFn: bankAccountOptions });
  const [person, setPerson] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Hand over the cash"
      description={`${account.custodian?.name ?? "No one"} answers for ${inr(account.balance, account.currency)} now. Count it together before handing it over; the change is kept on record.`}>
      <div className="flex flex-col gap-3">
        {failure && <Notice>{failure}</Notice>}
        <ComboBox label="New person responsible" isRequired selectedKey={person} onSelectionChange={(key) => setPerson(key ? String(key) : null)}
          options={(options.data?.people ?? []).filter((entry) => entry.id !== account.custodian?.id).map((entry) => ({ value: entry.id, label: entry.name }))} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!person || busy} onPress={async () => {
            setBusy(true); setFailure(null);
            try { await updateBankAccount(account.id, { custodianUserId: person }); await onDone(); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); }
          }}>Hand over</Button>
        </div>
      </div>
    </Dialog>
  );
}
