"use client";

// Payment Obligations & AP Aging: what posted supplier bills still owe, by instalment due date (the company's local date) — overdue, due today
// and due soon — and the statutory deadlines (MSMED Act) already breached. Read from Finance's settlements; nothing here pays anything.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, Select, StatusBadge } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcPanel } from "@/features/procurement/shared/ProcUi";
import { calendarDate, money } from "@/features/procurement/shared/format";

type Obligation = { scheduleId: string; billId: string; billNumber: string; supplierInvoice: string | null; supplierName: string; installment: number; installments: number; currencyCode: string;
  dueDate: string; originalDueDate: string; scheduled: string; outstanding: string; daysOverdue: number; dueToday?: boolean; href: string };
type Breach = { id: string; billId: string; billNumber: string; supplierName: string; sourceReference: string; statutoryDueDate: string; outstanding: string; classification: string | null; href: string };
type AgingRow = { supplierId: string; supplierName: string; currencyCode: string; notDue: string; dueToday: string; days1to30: string; days31to60: string; days61to90: string; over90: string; total: string };
type Payload = { overdue: { today: string; obligations: Obligation[]; statutory: Breach[] }; upcoming: { today: string; until: string; obligations: Obligation[] } };

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api/procurement/supplier-bills${path}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "The request could not be completed.");
  return payload;
}

function ObligationTable({ rows, overdue }: { rows: Obligation[]; overdue: boolean }) {
  if (!rows.length) return <p className="text-sm text-text-muted">{overdue ? "Nothing overdue." : "Nothing due in this period."}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-text-muted">{["Bill", "Supplier", "Instalment", "Due", overdue ? "Days overdue" : "", "Outstanding"].map((name, index) =>
          <th key={index} className={index >= 4 ? "py-1 pr-3 text-right font-normal" : "py-1 pr-3 font-normal"}>{name}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.scheduleId}>
              <td className="py-2 pr-3"><Link className="text-brand hover:underline" href={row.href}>{row.billNumber}</Link>{row.supplierInvoice && <span className="block text-xs text-text-muted">{row.supplierInvoice}</span>}</td>
              <td className="py-2 pr-3">{row.supplierName}</td>
              <td className="py-2 pr-3">{row.installment} of {row.installments}</td>
              <td className="py-2 pr-3">{calendarDate(row.dueDate)}{row.dueToday && <StatusBadge tone="warning">Due today</StatusBadge>}
                {row.originalDueDate !== row.dueDate && <span className="block text-xs text-text-muted">originally {calendarDate(row.originalDueDate)}</span>}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{overdue ? row.daysOverdue : ""}</td>
              <td className="py-2 pr-3 text-right font-medium tabular-nums">{money(row.currencyCode, row.outstanding)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ObligationsScreen() {
  const workspace = useWorkspaceContext();
  const [days, setDays] = useState("30");
  const obligations = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "obligations", days), queryFn: () => get<Payload>(`/obligations?days=${days}`) });
  const aging = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "ap-aging"), queryFn: () => get<{ rows: AgingRow[] }>("/aging") });
  if (obligations.isLoading || aging.isLoading) return <LoadingState label="Loading payment obligations" />;
  if (!obligations.data || !aging.data) return <ErrorState title="Could not load payment obligations" description={(obligations.error ?? aging.error) instanceof Error ? (obligations.error ?? aging.error)?.message : undefined} />;
  const { overdue, upcoming } = obligations.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Payment Obligations & AP Aging" description={`What posted supplier bills still owe, by instalment due date, as of ${calendarDate(overdue.today)} (the company's local date). Payments are recorded by Finance.`} />
      {overdue.statutory.length > 0 && (
        <ProcPanel title="Statutory deadlines breached (MSMED Act)" description="Micro and small suppliers past their legal payment deadline. Statutory interest is for Finance and Compliance to assess.">
          <ul className="flex flex-col divide-y divide-border text-sm">
            {overdue.statutory.map((entry) => <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2"><span><Link className="text-brand hover:underline" href={entry.href}>{entry.billNumber}</Link>
              {" "}· {entry.supplierName} ({entry.classification}) · {entry.sourceReference} · deadline {calendarDate(entry.statutoryDueDate)}</span><span className="font-medium tabular-nums">{entry.outstanding}</span></li>)}
          </ul>
        </ProcPanel>
      )}
      <ProcPanel title="Overdue instalments" description="Only the instalments past due — a bill's later instalments are not overdue with them.">
        <ObligationTable rows={overdue.obligations} overdue />
      </ProcPanel>
      <ProcPanel title="Due soon" actions={<Select aria-label="Period" size="compact" selectedKey={days} onSelectionChange={(value) => setDays(String(value))}
        options={[["7", "Next 7 days"], ["15", "Next 15 days"], ["30", "Next 30 days"], ["60", "Next 60 days"], ["90", "Next 90 days"]].map(([value, label]) => ({ value, label }))} />}>
        <ObligationTable rows={upcoming.obligations} overdue={false} />
      </ProcPanel>
      <ProcPanel title="AP aging by instalment" description="Each instalment in the bucket of its own due date.">
        {!aging.data.rows.length ? <p className="text-sm text-text-muted">Nothing owed.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-text-muted">{["Supplier", "Not due", "Due today", "1–30", "31–60", "61–90", "Over 90", "Total"].map((name, index) =>
                <th key={name} className={index ? "py-1 pr-3 text-right font-normal" : "py-1 pr-3 font-normal"}>{name}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {aging.data.rows.map((row) => (
                  <tr key={`${row.supplierId}-${row.currencyCode}`}>
                    <td className="py-2 pr-3">{row.supplierName}</td>
                    {[row.notDue, row.dueToday, row.days1to30, row.days31to60, row.days61to90, row.over90, row.total].map((value, index) =>
                      <td key={index} className={`py-2 pr-3 text-right tabular-nums${index === 6 ? " font-medium" : ""}`}>{Number(value) ? money(row.currencyCode, value) : "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ProcPanel>
    </div>
  );
}
