"use client";

// Payables › Due & Overdue (Procurement plan Phase 1): what posted supplier bills still owe, by instalment due date (the company's local
// date). It opens on "Due this week" — overdue and due in the next 7 days — with micro and small suppliers (MSMED Act, 45 days at most)
// first; other views show only the overdue, the next 30 days, and AP ageing. Choose instalments and "Pay selected": one payment per
// supplier, through Finance's approval policy.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Wallet } from "lucide-react";
import { Button, Checkbox, Dialog, ErrorState, PageHeader, Select, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { calendarDate, money } from "@/features/procurement/shared/format";
import { useListState } from "@/features/procurement/shared/navigation";
import { Notice, Panel } from "@/shared/ui/Panel";
import { getBillOptions } from "../api/supplier-bills-api";
import { errorMessage, paySupplierBills, type PayResult } from "../../payments/api";

type Obligation = { scheduleId: string; billId: string; billNumber: string; supplierInvoice: string | null; supplierId: string; supplierName: string; installment: number; installments: number;
  currencyCode: string; dueDate: string; originalDueDate: string; scheduled: string; outstanding: string; daysOverdue: number; dueToday?: boolean; msme: string | null; href: string };
type Breach = { id: string; billId: string; billNumber: string; supplierName: string; sourceReference: string; statutoryDueDate: string; outstanding: string; classification: string | null; href: string };
type AgingRow = { supplierId: string; supplierName: string; currencyCode: string; notDue: string; dueToday: string; days1to30: string; days31to60: string; days61to90: string; over90: string; total: string };
type Payload = { overdue: { today: string; obligations: Obligation[]; statutory: Breach[] }; upcoming: { today: string; until: string; obligations: Obligation[] } };

const VIEWS = [
  { id: "due-week", label: "Due this week" }, { id: "overdue", label: "Overdue" }, { id: "next-30", label: "Next 30 days" }, { id: "aging", label: "what is owed, by age" },
] as const;

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api/procurement/supplier-bills${path}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "The request could not be completed.");
  return payload;
}

// MSME first, then by due date.
const ordered = (rows: Obligation[]) => [...rows].sort((a, b) => Number(Boolean(b.msme)) - Number(Boolean(a.msme)) || a.dueDate.localeCompare(b.dueDate) || a.billNumber.localeCompare(b.billNumber));

function ObligationTable({ rows, showOverdue, selected, onToggle, selectable }: {
  rows: Obligation[]; showOverdue: boolean; selected: Set<string>; onToggle: (row: Obligation, on: boolean) => void; selectable: boolean;
}) {
  if (!rows.length) return <p className="text-sm text-text-muted">Nothing to pay in this view.</p>;
  const allOn = rows.every((row) => selected.has(row.scheduleId));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-muted">
            {selectable && <th className="w-8 py-1 pr-2 font-normal"><Checkbox aria-label="Choose all" isSelected={allOn} onChange={(on) => rows.forEach((row) => onToggle(row, on))} /></th>}
            {["Bill", "Supplier", "Payment due", "Due", showOverdue ? "Days overdue" : "", "Outstanding"].map((name, index) =>
              <th key={index} className={index >= 4 ? "py-1 pr-3 text-right font-normal" : "py-1 pr-3 font-normal"}>{name}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.scheduleId}>
              {selectable && <td className="py-2 pr-2"><Checkbox aria-label={`Pay ${row.billNumber}`} isSelected={selected.has(row.scheduleId)} onChange={(on) => onToggle(row, on)} /></td>}
              <td className="py-2 pr-3"><Link className="text-brand hover:underline" href={row.href}>{row.billNumber}</Link>{row.supplierInvoice && <span className="block text-xs text-text-muted">{row.supplierInvoice}</span>}</td>
              <td className="py-2 pr-3"><span className="flex flex-wrap items-center gap-1">{row.supplierName}{row.msme && <StatusBadge tone="info">{`MSME · ${row.msme}`}</StatusBadge>}</span></td>
              <td className="py-2 pr-3">{row.installments > 1 ? `${row.installment} of ${row.installments}` : "—"}</td>
              <td className="py-2 pr-3"><span className={row.daysOverdue > 0 ? "text-danger" : undefined}>{calendarDate(row.dueDate)}</span>{row.dueToday && <> <StatusBadge tone="warning">Due today</StatusBadge></>}
                {row.originalDueDate !== row.dueDate && <span className="block text-xs text-text-muted">originally {calendarDate(row.originalDueDate)}</span>}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{showOverdue && row.daysOverdue > 0 ? row.daysOverdue : ""}</td>
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
  const list = useListState("payables", { view: "due-week", filters: {} });
  const view = VIEWS.some((entry) => entry.id === list.view) ? list.view : "due-week";
  const days = view === "next-30" ? "30" : "7";
  const obligations = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "obligations", days), queryFn: () => get<Payload>(`/obligations?days=${days}`), enabled: view !== "aging" });
  const aging = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "ap-aging"), queryFn: () => get<{ rows: AgingRow[] }>("/aging"), enabled: view === "aging" });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill-options"), queryFn: () => getBillOptions(), staleTime: 60_000 });
  const canPay = Boolean(options.data?.capabilities.payments);
  const [selected, setSelected] = useState<Map<string, Obligation>>(new Map());
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<PayResult | null>(null);
  const rows = useMemo(() => {
    if (!obligations.data) return [];
    const { overdue, upcoming } = obligations.data;
    return ordered(view === "overdue" ? overdue.obligations : view === "next-30" ? upcoming.obligations : [...overdue.obligations, ...upcoming.obligations]);
  }, [obligations.data, view]);
  const toggle = (row: Obligation, on: boolean) => setSelected((current) => {
    const next = new Map(current);
    if (on) next.set(row.scheduleId, row); else next.delete(row.scheduleId);
    return next;
  });
  const chosen = [...selected.values()];
  const loading = view === "aging" ? aging.isLoading : obligations.isLoading;
  const error = view === "aging" ? aging.error : obligations.error;
  const today = obligations.data?.overdue.today;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Due & Overdue"
        description={`What final bills still owe, by due date${today ? `, as of ${calendarDate(today)}` : ""}. MSME suppliers come first (45 days at most).`}
        secondaryActions={<Link className="text-sm text-brand hover:underline" href="/procurement/payables/msme">MSME payments</Link>} />
      <Tabs selectedKey={view} onSelectionChange={(key) => { list.setView(String(key)); setSelected(new Map()); }}>
        <TabList aria-label="Due & Overdue views">{VIEWS.map((entry) => <Tab key={entry.id} id={entry.id}>{entry.label}</Tab>)}</TabList>
      </Tabs>
      {done && (
        <Notice tone="success">
          {done.payments.map((payment) => (
            <span key={payment.paymentId} className="block">
              <Link className="font-medium underline" href={`/procurement/payments/${payment.paymentId}`}>{payment.paymentNumber}</Link>{" "}
              {payment.status === "awaiting_approval" ? "awaits Finance's approval" : "recorded"} for {payment.bills.join(", ")}.
              {payment.advice && <span className="text-text-secondary"> {payment.advice === "sent" ? "Payment advice emailed." : `Payment advice not sent: ${payment.advice}`}</span>}
            </span>
          ))}
          {done.payments.length > 0 && (
            <a className="mt-2 inline-flex w-fit items-center gap-1.5 font-medium underline" href={`/api/procurement/payments/bank-file?ids=${done.payments.map((payment) => payment.paymentId).join(",")}`}>
              <Download className="size-4" aria-hidden="true" />Download bank file
            </a>
          )}
        </Notice>
      )}
      {loading ? <LoadingState label="Loading payables" /> : error ? <ErrorState title="Could not load payables" description={errorMessage(error)} /> : view === "aging" ? (
        <Panel title="Owed, by age" description="Each payment due counts in the bucket of its own due date.">
          {!aging.data?.rows.length ? <p className="text-sm text-text-muted">Nothing owed.</p> : (
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
        </Panel>
      ) : (
        <>
          {obligations.data && obligations.data.overdue.statutory.length > 0 && view !== "next-30" && (
            <Notice tone="danger">
              {obligations.data.overdue.statutory.length} MSME deadline{obligations.data.overdue.statutory.length > 1 ? "s are" : " is"} past the legal limit.{" "}
              <Link className="font-medium underline" href="/procurement/payables/msme?bucket=overdue">See MSME payments</Link>
            </Notice>
          )}
          <Panel title={VIEWS.find((entry) => entry.id === view)?.label ?? "Due"}
            description={view === "due-week" ? "Overdue, and due in the next 7 days." : view === "overdue" ? "Only the payments due past due — a bill's later payments due are not overdue with them." : "Due in the next 30 days."}
            actions={canPay ? (
              <Button variant="primary" size="compact" isDisabled={!chosen.length} onPress={() => setPaying(true)}>
                <Wallet className="size-4" aria-hidden="true" />{chosen.length ? `Pay selected (${new Set(chosen.map((row) => row.billId)).size})` : "Pay selected"}
              </Button>
            ) : undefined}>
            <ObligationTable rows={rows} showOverdue={view !== "next-30"} selected={new Set(selected.keys())} onToggle={toggle} selectable={canPay} />
          </Panel>
        </>
      )}
      {paying && <PayDialog rows={chosen} bankAccounts={options.data?.bankAccounts ?? []} onClose={() => setPaying(false)}
        onDone={(result) => { setPaying(false); setSelected(new Map()); setDone(result); }} />}
    </div>
  );
}

function PayDialog({ rows, bankAccounts, onClose, onDone }: { rows: Obligation[]; bankAccounts: Array<{ id: string; name: string }>; onClose: () => void; onDone: (result: PayResult) => void }) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState("bank_transfer");
  const [bank, setBank] = useState("none");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  // One amount per bill: the outstanding of its chosen instalments.
  const bills = useMemo(() => {
    const byBill = new Map<string, { billId: string; billNumber: string; supplierName: string; currencyCode: string; amount: number }>();
    for (const row of rows) {
      const entry = byBill.get(row.billId) ?? { billId: row.billId, billNumber: row.billNumber, supplierName: row.supplierName, currencyCode: row.currencyCode, amount: 0 };
      entry.amount += Number(row.outstanding);
      byBill.set(row.billId, entry);
    }
    return [...byBill.values()];
  }, [rows]);
  const suppliers = new Set(bills.map((bill) => bill.supplierName)).size;
  const currencies = [...new Set(bills.map((bill) => bill.currencyCode))];
  const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
  const run = useMutation({
    mutationFn: () => paySupplierBills({ bills: bills.map((bill) => ({ billId: bill.billId, amount: bill.amount.toFixed(2) })), paymentMethod: method,
      bankAccountId: bank === "none" ? undefined : bank, reference: reference || undefined, paymentDate: date || undefined }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes("procurement") });
      onDone(result);
    },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Pay selected bills" size="lg"
      description={`${bills.length} bill${bills.length > 1 ? "s" : ""} to ${suppliers} supplier${suppliers > 1 ? "s" : ""}: one payment per supplier, recorded through Finance.`}>
      <div className="flex flex-col gap-3">
        {run.error && <Notice>{errorMessage(run.error)}</Notice>}
        <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-[var(--radius-control)] border border-border text-sm">
          {bills.map((bill) => (
            <li key={bill.billId} className="flex justify-between gap-2 px-3 py-1.5"><span>{bill.billNumber} · {bill.supplierName}</span>
              <span className="tabular-nums">{money(bill.currencyCode, bill.amount.toFixed(2))}</span></li>
          ))}
        </ul>
        {currencies.length === 1 && <p className="text-right text-sm font-medium tabular-nums">Total {money(currencies[0], total.toFixed(2))}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <TextField label="Payment date" type="date" value={date} onChange={setDate} description="Today if empty." />
          <Select label="Method" selectedKey={method} onSelectionChange={(value) => setMethod(String(value))}
            options={[["bank_transfer", "Bank transfer (NEFT/RTGS/IMPS)"], ["cheque", "Cheque"], ["upi", "UPI"], ["cash", "Cash"], ["other", "Other"]].map(([value, label]) => ({ value, label }))} />
          <Select label="Paid from" selectedKey={bank} onSelectionChange={(value) => setBank(String(value))}
            options={[{ value: "none", label: "Default bank account" }, ...bankAccounts.map((entry) => ({ value: entry.id, label: entry.name }))]} />
          <TextField label="Reference (UTR, cheque no.)" value={reference} onChange={setReference} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={run.isPending} onPress={() => run.mutate()}>Pay {bills.length} bill{bills.length > 1 ? "s" : ""}</Button>
        </div>
      </div>
    </Dialog>
  );
}
