"use client";

// An account's ledger: the balance brought forward, every posted line between two dates with its running balance, and for each line the
// journal and the document it came from. Opened from the General Ledger it keeps that screen's dates and department / cost centre.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumb, Button, ErrorState, MetricCard, PageHeader, PermissionState, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { accountLedger, amount, errorMessage, errorStatus, plain } from "../api/journals-api";

const firstOfMonth = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`; };

export function AccountLedgerScreen({ accountId }: { accountId: string }) {
  const workspace = useWorkspaceContext();
  const params = useSearchParams();
  const [from, setFrom] = useState(() => params.get("from") ?? firstOfMonth());
  const [to, setTo] = useState(() => params.get("to") ?? "");
  const [departmentId, setDepartmentId] = useState(() => params.get("departmentId"));
  const [costCenterId, setCostCenterId] = useState(() => params.get("costCenterId"));
  const filters = { from: from || undefined, to: to || undefined, departmentId: departmentId ?? undefined, costCenterId: costCenterId ?? undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "ledger", accountId, filters), queryFn: () => accountLedger(accountId, filters),
    placeholderData: (previous) => previous, retry: false });
  if (query.isLoading) return <LoadingState label="Loading the ledger" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the ledger" description={errorMessage(query.error)} />;
  }
  const ledger = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader breadcrumbs={[<Breadcrumb key="gl" href="/accounting/general-ledger">General ledger</Breadcrumb>, <Breadcrumb key="this" isCurrent>{ledger.account.code}</Breadcrumb>]}
        title={`${ledger.account.code} · ${ledger.account.name}`}
        description={`${ledger.account.accountClass} account · normal balance ${ledger.account.normalBalance}. Every posted entry, with its running balance.`} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="From" size="compact" type="date" value={from} onChange={setFrom} />
        <TextField label="To" size="compact" type="date" value={to} onChange={setTo} />
        {departmentId && <Button size="compact" variant="secondary" onPress={() => setDepartmentId(null)}>One department only ✕</Button>}
        {costCenterId && <Button size="compact" variant="secondary" onPress={() => setCostCenterId(null)}>One cost centre only ✕</Button>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Brought forward" value={amount(ledger.opening)} />
        <MetricCard label="Debits" value={amount(ledger.debit)} />
        <MetricCard label="Credits" value={amount(ledger.credit)} />
        <MetricCard label="Closing balance" value={amount(ledger.closing)} />
      </div>
      <Panel>
        <LinesTable columns={["Date", "Journal", "Document", "Description", { label: "Debit", numeric: true }, { label: "Credit", numeric: true }, { label: "Balance", numeric: true }]}
          empty={ledger.lines.length ? undefined : "No postings in this period."}>
          {ledger.lines.map((line, index) => (
            <tr key={`${line.journalEntryId}-${index}`}>
              <Cell className="whitespace-nowrap">{formatDate(line.date)}</Cell>
              <Cell><Link className="text-brand underline" href={`/accounting/journals/${line.journalEntryId}`}>{line.journalNumber}</Link></Cell>
              <Cell>{line.sourceHref ? <Link className="text-brand underline" href={line.sourceHref}>{line.document}{line.sourceNumber ? ` ${line.sourceNumber}` : ""}</Link> : line.document}</Cell>
              <Cell>{line.description}{line.party ? <span className="block text-xs text-text-muted">{line.party}</span> : null}</Cell>
              <Cell numeric>{plain(line.debit)}</Cell>
              <Cell numeric>{plain(line.credit)}</Cell>
              <Cell numeric>{amount(line.balance)}</Cell>
            </tr>
          ))}
        </LinesTable>
      </Panel>
    </div>
  );
}
