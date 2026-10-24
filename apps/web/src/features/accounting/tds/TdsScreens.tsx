"use client";

// Supplier TDS (Procurement report Phase 2): what is waiting to be deposited, by month and section with its due date; the challans that
// deposited it; and the quarter's 26Q — its challans, deductees and what stops filing — with the file for the return utility.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Landmark } from "lucide-react";
import {
  Button, Checkbox, Dialog, EmptyState, ErrorState, LinkButton, PageHeader, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextField,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useAccountingOptions } from "@/features/accounting/shared/client";

type Group = { period: string; sectionCode: string | null; dueDate: string; count: number; taxable: string; tds: string; rowIds: string[]; missingPan: number; overdue: boolean };
type Challan = { id: string; depositDate: string; bsrCode: string; challanSerial: string; tax: string; interest: string; fee: string; total: string; status: string; cancelReason: string | null; rows: number };
type Deductee = { id: string; partyName: string | null; pan: string | null; sectionCode: string | null; creditedOn: string | null; taxable: string; tds: string; documentNumber: string | null;
  challan: { bsrCode: string; serial: string; date: string } | null };
type Return26Q = { fy: number; quarter: number; dueDate: string; challans: Challan[]; deductees: Deductee[]; total: string; problems: string[] };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/accounting/tds${path}`, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "That did not work.");
  return payload as T;
}
const rupees = (value: string | number) => `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = (period: string) => new Date(`${period}-01T12:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const dateText = (value: string | null) => (value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const currentFy = () => { const now = new Date(); return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; };

export function TdsScreen() {
  const [tab, setTab] = useState<"to-deposit" | "deposits" | "26q">("to-deposit");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="TDS Deposits & Returns" description="TDS deducted from suppliers, deposited by challan and filed in 26Q." />
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key) as typeof tab)}>
        <TabList aria-label="TDS">
          <Tab id="to-deposit">To deposit</Tab>
          <Tab id="deposits">Deposits</Tab>
          <Tab id="26q">26Q</Tab>
        </TabList>
        <TabPanel id="to-deposit"><div className="pt-4"><ToDeposit /></div></TabPanel>
        <TabPanel id="deposits"><div className="pt-4"><Deposits /></div></TabPanel>
        <TabPanel id="26q"><div className="pt-4"><Return26QPanel /></div></TabPanel>
      </Tabs>
    </div>
  );
}

function ToDeposit() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "tds", "to-deposit"), queryFn: () => call<{ groups: Group[] }>("?view=to-deposit") });
  const [chosen, setChosen] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading TDS to deposit" />;
  if (query.isError || !query.data) return <ErrorState title="Could not load TDS to deposit" description={query.error instanceof Error ? query.error.message : undefined} />;
  const groups = query.data.groups;
  const keyOf = (group: Group) => `${group.period}:${group.sectionCode ?? ""}`;
  const picked = groups.filter((group) => chosen.includes(keyOf(group)));
  const total = picked.reduce((sum, group) => sum + Number(group.tds), 0);
  if (!groups.length) return <EmptyState title="Nothing to deposit" description="TDS deducted from suppliers shows here until its challan is recorded." />;
  return (
    <Panel title="Waiting to be deposited" description="Deposit each month's TDS by the 7th of the next month (March: 30 April)."
      actions={<Button variant="primary" isDisabled={!picked.length} onPress={() => setOpen(true)}><Landmark className="size-4" aria-hidden="true" />Record challan</Button>}>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {groups.map((group) => (
          <li key={keyOf(group)} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
            <Checkbox isSelected={chosen.includes(keyOf(group))} onChange={(on) => setChosen((state) => (on ? [...state, keyOf(group)] : state.filter((key) => key !== keyOf(group))))}>
              <span className="font-medium">{monthName(group.period)} · {group.sectionCode ?? "No section"}</span>
              <span className="block text-xs text-text-muted">{group.count} deduction{group.count === 1 ? "" : "s"} on {rupees(group.taxable)}{group.missingPan ? ` · ${group.missingPan} without PAN` : ""}</span>
            </Checkbox>
            <span className="flex flex-wrap items-center gap-2 pl-7 sm:pl-0">
              <span className="font-medium tabular-nums">{rupees(group.tds)}</span>
              <StatusBadge tone={group.overdue ? "danger" : "info"}>{group.overdue ? `Overdue since ${dateText(group.dueDate)}` : `Due ${dateText(group.dueDate)}`}</StatusBadge>
            </span>
          </li>
        ))}
      </ul>
      {open && <ChallanDialog rowIds={picked.flatMap((group) => group.rowIds)} total={total} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setChosen([]); }} />}
    </Panel>
  );
}

function ChallanDialog({ rowIds, total, onClose, onDone }: { rowIds: string[]; total: number; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const options = useAccountingOptions();
  const [values, setValues] = useState({ depositDate: "", bsrCode: "", challanSerial: "", interest: "", fee: "", extraAccountId: "", bankAccountId: "" });
  const set = (key: keyof typeof values) => (value: string) => setValues((state) => ({ ...state, [key]: value }));
  const extra = Number(values.interest || 0) + Number(values.fee || 0);
  const save = useMutation({
    mutationFn: () => call<{ result: { reference: string } }>("", { method: "POST", body: JSON.stringify({ action: "deposit", taxLedgerIds: rowIds, depositDate: values.depositDate,
      bsrCode: values.bsrCode.trim(), challanSerial: values.challanSerial.trim(), interest: values.interest || undefined, fee: values.fee || undefined,
      extraAccountId: extra > 0 ? values.extraAccountId || undefined : undefined, bankAccountId: values.bankAccountId || undefined }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting", "tds") }); onDone(); },
  });
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(values.depositDate) && /^\d{7}$/.test(values.bsrCode.trim()) && /^\d{1,5}$/.test(values.challanSerial.trim()) && (extra === 0 || values.extraAccountId);
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title="Record the TDS challan" description={`TDS ${rupees(total)}, from the challan's receipt (ITNS 281).`} size="md">
      <div className="flex flex-col gap-3">
        {save.error && <Notice>{save.error instanceof Error ? save.error.message : "Could not record the challan."}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Paid on" type="date" isRequired value={values.depositDate} onChange={set("depositDate")} />
          <Select label="Paid from" selectedKey={values.bankAccountId || "default"} onSelectionChange={(key) => set("bankAccountId")(key === "default" ? "" : String(key))}
            options={[{ value: "default", label: "The default bank account" }, ...(options.data?.bankAccounts ?? []).map((account) => ({ value: account.id, label: account.name }))]} />
          <TextField label="BSR code" isRequired inputMode="numeric" value={values.bsrCode} onChange={(value) => set("bsrCode")(value.replace(/\D/g, "").slice(0, 7))} description="7 digits" />
          <TextField label="Challan serial number" isRequired inputMode="numeric" value={values.challanSerial} onChange={(value) => set("challanSerial")(value.replace(/\D/g, "").slice(0, 5))} />
          <TextField label="Interest" inputMode="decimal" value={values.interest} onChange={(value) => set("interest")(value.replace(/[^0-9.]/g, ""))} description="Paid for late deposit" />
          <TextField label="Late fee (234E)" inputMode="decimal" value={values.fee} onChange={(value) => set("fee")(value.replace(/[^0-9.]/g, ""))} />
          {extra > 0 && (
            <Select label="Book interest and fee to" isRequired selectedKey={values.extraAccountId || null} onSelectionChange={(key) => set("extraAccountId")(String(key))} className="sm:col-span-2"
              options={(options.data?.accounts ?? []).map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }))} />
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!ready} isLoading={save.isPending} onPress={() => save.mutate()}>Record challan</Button>
        </div>
      </div>
    </Dialog>
  );
}

function Deposits() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [fy, setFy] = useState(currentFy());
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "tds", "deposits", fy), queryFn: () => call<{ rows: Challan[] }>(`?view=deposits&fy=${fy}`) });
  const [cancelling, setCancelling] = useState<Challan | null>(null);
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: () => call("", { method: "POST", body: JSON.stringify({ action: "cancel", challanId: cancelling!.id, reason: reason.trim() }) }),
    onSuccess: () => { setCancelling(null); setReason(""); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting", "tds") }); },
  });
  return (
    <Panel title="Challans" actions={<FyPicker value={fy} onChange={setFy} />}>
      {query.isLoading ? <LoadingState label="Loading challans" /> : query.isError ? <Notice>{query.error instanceof Error ? query.error.message : "Could not load challans."}</Notice>
        : !query.data?.rows.length ? <p className="text-sm text-text-muted">No challans recorded in this year.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {query.data.rows.map((challan) => (
              <li key={challan.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span><span className="font-medium tabular-nums">{challan.bsrCode} / {challan.challanSerial}</span> · {dateText(challan.depositDate)}
                  <span className="block text-xs text-text-muted">{challan.rows} deduction{challan.rows === 1 ? "" : "s"}{Number(challan.interest) + Number(challan.fee) > 0 ? ` · interest and fee ${rupees(Number(challan.interest) + Number(challan.fee))}` : ""}
                    {challan.cancelReason ? ` · cancelled: ${challan.cancelReason}` : ""}</span></span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium tabular-nums">{rupees(challan.total)}</span>
                  {challan.status === "cancelled" ? <StatusBadge tone="neutral">Cancelled</StatusBadge>
                    : <Button size="compact" variant="ghost" onPress={() => setCancelling(challan)}>Cancel</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      {cancelling && (
        <Dialog isOpen onOpenChange={(isOpen) => !isOpen && setCancelling(null)} title={`Cancel challan ${cancelling.bsrCode}/${cancelling.challanSerial}?`}
          description="Its journal is reversed and its TDS waits to be deposited again." size="md">
          <div className="flex flex-col gap-3">
            {cancel.error && <Notice>{cancel.error instanceof Error ? cancel.error.message : "Could not cancel."}</Notice>}
            <TextField label="Reason" isRequired value={reason} onChange={setReason} />
            <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setCancelling(null)}>Keep it</Button>
              <Button variant="danger" isDisabled={reason.trim().length < 3} isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel challan</Button></div>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}

function FyPicker({ value, onChange }: { value: number; onChange: (fy: number) => void }) {
  const years = useMemo(() => [0, 1, 2].map((back) => currentFy() - back), []);
  return <Select aria-label="Financial year" size="compact" selectedKey={String(value)} onSelectionChange={(key) => onChange(Number(key))}
    options={years.map((year) => ({ value: String(year), label: `FY ${year}-${String(year + 1).slice(2)}` }))} />;
}

function Return26QPanel() {
  const workspace = useWorkspaceContext();
  const [fy, setFy] = useState(currentFy());
  const [quarter, setQuarter] = useState(() => { const month = new Date().getMonth() + 1; return month >= 4 && month <= 6 ? 1 : month >= 7 && month <= 9 ? 2 : month >= 10 ? 3 : 4; });
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "tds", "26q", fy, quarter), queryFn: () => call<Return26Q>(`?view=26q&fy=${fy}&quarter=${quarter}`) });
  const data = query.data;
  return (
    <Panel title="Form 26Q" description="TDS on payments to suppliers other than salary, each quarter."
      actions={<div className="flex flex-wrap gap-2"><FyPicker value={fy} onChange={setFy} />
        <Select aria-label="Quarter" size="compact" selectedKey={String(quarter)} onSelectionChange={(key) => setQuarter(Number(key))}
          options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: ["Q1 Apr–Jun", "Q2 Jul–Sep", "Q3 Oct–Dec", "Q4 Jan–Mar"][q - 1] }))} /></div>}>
      {query.isLoading ? <LoadingState label="Loading 26Q" /> : query.isError || !data ? <Notice>{query.error instanceof Error ? query.error.message : "Could not load 26Q."}</Notice> : (
        <div className="flex flex-col gap-3">
          <p className="text-sm">Due {dateText(data.dueDate)} · {data.deductees.length} deduction{data.deductees.length === 1 ? "" : "s"} · TDS {rupees(data.total)} · {data.challans.length} challan{data.challans.length === 1 ? "" : "s"}</p>
          {data.problems.length > 0 && <Notice tone="warning"><ul className="list-disc pl-5">{data.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></Notice>}
          {data.deductees.length > 0 && (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {data.deductees.slice(0, 200).map((row) => (
                <li key={row.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
                  <span><span className="font-medium">{row.partyName ?? "—"}</span> · {row.pan ?? "No PAN"} · {row.sectionCode ?? "No section"}
                    <span className="block text-xs text-text-muted">{row.documentNumber} · {dateText(row.creditedOn)} · {row.challan ? `challan ${row.challan.bsrCode}/${row.challan.serial}` : "not deposited"}</span></span>
                  <span className="tabular-nums">{rupees(row.tds)} on {rupees(row.taxable)}</span>
                </li>
              ))}
            </ul>
          )}
          <LinkButton className="w-fit" variant="secondary" href={`/api/accounting/tds/26q?fy=${fy}&quarter=${quarter}`} isDisabled={!data.deductees.length}>
            <Download className="size-4" aria-hidden="true" />Download 26Q data
          </LinkButton>
        </div>
      )}
    </Panel>
  );
}
