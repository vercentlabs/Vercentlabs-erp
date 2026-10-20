"use client";

// Sub-ledgers vs books: each module's own record (open invoices and bills, valued stock, goods received not billed, asset events, payroll
// dues) against the accounts that summarise it. Agreeing checks are quiet; a difference shows its amount, the likely cause and the
// documents behind it.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, MinusCircle } from "lucide-react";
import { ErrorState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { amount, errorMessage, moduleBooks, type BooksCheck } from "../api/automatic-api";

const LOOK: Record<BooksCheck["status"], { icon: typeof CheckCircle2; tone: string; label: string }> = {
  ok: { icon: CheckCircle2, tone: "border-border bg-surface", label: "Agrees" },
  difference: { icon: AlertTriangle, tone: "border-warning-emphasis/30 bg-warning-soft", label: "Differs" },
  attention: { icon: AlertTriangle, tone: "border-warning-emphasis/30 bg-warning-soft", label: "Needs attention" },
  not_applicable: { icon: MinusCircle, tone: "border-border bg-surface-muted", label: "Not used" },
  info: { icon: Info, tone: "border-border bg-surface", label: "For information" },
};
const ICON_TONE: Record<BooksCheck["status"], string> = { ok: "text-success", difference: "text-warning", attention: "text-warning", not_applicable: "text-text-muted", info: "text-info" };

export function BooksChecks() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "books"), queryFn: moduleBooks, retry: false });
  if (query.isLoading) return <LoadingState label="Comparing the sub-ledgers with the books" rows={6} />;
  if (query.isError || !query.data) return <ErrorState title="Could not compare the sub-ledgers" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const { checks, agree } = query.data;
  return (
    <div className="flex flex-col gap-3">
      <Notice tone={agree ? "success" : "warning"}>
        {agree ? "Every sub-ledger agrees with its accounts." : "Some sub-ledgers differ from their accounts. A difference means a posting is missing or went to the wrong account — correct it at its source, never with a balancing journal."}
      </Notice>
      <div className="grid gap-3 lg:grid-cols-2">
        {checks.map((check) => <CheckCard key={check.key} check={check} />)}
      </div>
    </div>
  );
}

function CheckCard({ check }: { check: BooksCheck }) {
  const look = LOOK[check.status];
  const Icon = look.icon;
  const compares = check.ledger !== undefined && check.subledger !== undefined;
  return (
    <section className={`flex flex-col gap-2 rounded-[var(--radius-panel)] border p-4 ${look.tone}`}>
      <header className="flex items-start gap-2">
        <Icon className={`mt-0.5 size-4 shrink-0 ${ICON_TONE[check.status]}`} aria-hidden="true" />
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{check.area} · {look.label}</span>
          <span className="text-sm font-semibold text-text">{check.label}</span>
        </div>
      </header>
      {compares && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm tabular-nums">
          <dt className="text-text-secondary">Books: {check.ledgerLabel}</dt><dd className="text-right">{amount(check.ledger)}</dd>
          <dt className="text-text-secondary">Sub-ledger: {check.subledgerLabel}</dt><dd className="text-right">{amount(check.subledger)}</dd>
          {check.status === "difference" && <><dt className="font-medium text-text">Difference</dt><dd className="text-right font-medium text-text">{amount(check.difference)}</dd></>}
        </dl>
      )}
      {check.note && <p className="text-xs text-text-secondary">{check.note}</p>}
      {(check.items?.length ?? 0) > 0 && (
        <ul className="flex flex-col divide-y divide-border/60 text-sm">
          {check.items!.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-3 py-1">
              {item.href ? <Link className="truncate text-brand underline" href={item.href}>{item.label}</Link> : <span className="truncate text-text-secondary">{item.label}</span>}
              <span className="whitespace-nowrap tabular-nums">{amount(item.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {check.href && check.status !== "not_applicable" && <Link className="self-start text-xs text-brand underline" href={check.href}>Open {check.area.toLowerCase()}</Link>}
    </section>
  );
}
