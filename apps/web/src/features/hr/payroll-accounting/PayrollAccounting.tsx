"use client";

// Payroll after approval: post to Finance (or unpost before payment), publish payslips, record salary payments and payment exceptions,
// close; and the Payroll Reports page with the statutory deposits (challans).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { errorMessage, newKey } from "@/features/quality/specifications/spec-api";
import { formatDateTime } from "@/shared/format/human";
import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Option = { value: string; label: string };
type Slip = { id: string; payslip_number: string; employee_number: string; first_name: string; last_name: string | null; net_pay: string; paid_amount: string; payment_status: string;
  payment_exception: string | null; status: string; published_at: string | null };
type RunData = { banks: Option[]; payments: Array<{ payment_number: string; payment_date: string; amount: string; method: string; reference: string | null }>; slips: Slip[];
  journal: { entry_number: string; status: string } | null };
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/hr/payroll-accounting${path}`, { credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "The request could not be completed.");
  return payload as T;
}
const money = (n: string | number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { UNPAID: "neutral", PARTIALLY_PAID: "warning", PAID: "success", PAYMENT_EXCEPTION: "danger" };

export function PayrollAccountingPanel({ runId, status, onChanged }: { runId: string; status: string; onChanged?: () => void }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const key = scopedQueryKey(workspace, "hr", "payroll-accounting", runId);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: key, queryFn: () => call<RunData>(`?runId=${runId}`), retry: false, enabled: ["approved", "posted", "partially_paid", "paid", "closed"].includes(status) });
  if (!["approved", "posted", "partially_paid", "paid", "closed"].includes(status)) return null;
  if (q.isLoading) return <LoadingState label="Loading payments" rows={2} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  const run = async (body: Record<string, unknown>) => {
    setError(null);
    try { await call("", { method: "POST", body: JSON.stringify({ runId, ...body }) }); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr") }); onChanged?.(); }
    catch (e) { setError(errorMessage(e)); throw e; }
  };
  const payAsk = (slip?: Slip): Ask => ({ title: slip ? `Pay ${slip.payslip_number}` : "Record salary payment", confirm: "Record payment",
    description: slip ? `${money(Number(slip.net_pay) - Number(slip.paid_amount))} is still owed.` : "Pays every payslip still owed (held ones are skipped). It posts to Finance once: salaries payable against the bank.",
    fields: [{ name: "paymentDate", label: "Paid on", kind: "date", required: true }, { name: "paidFromAccountId", label: "Paid from", kind: "select", required: true, options: d.banks },
      { name: "method", label: "Method", kind: "select", initial: "bank_transfer", options: [{ value: "bank_transfer", label: "Bank transfer" }, { value: "cheque", label: "Cheque" }, { value: "cash", label: "Cash" }] },
      { name: "reference", label: "Reference (batch, UTR)", kind: "text" }, ...(slip ? [{ name: "amount", label: "Amount", kind: "quantity" as const, initial: String(Number(slip.net_pay) - Number(slip.paid_amount)) }] : [])],
    run: async (v) => { await run({ action: "pay", ...v, idempotencyKey: newKey(), ...(slip ? { payslipIds: [slip.id], amounts: { [slip.id]: Number(v.amount) } } : {}) }); } });
  return (
    <Panel title="Accounting and payment" description={d.journal ? `Posted to Finance as ${d.journal.entry_number}.` : "Not posted to Finance yet."}
      actions={<span className="flex flex-wrap gap-2">
        {status === "approved" && <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Post to Finance", confirm: "Post", description: "One journal: gross pay to salaries and wages by department, employer EPF / ESI to contribution expense; net pay to salaries payable; TDS, EPF, ESI and PT to their payables.",
          fields: [{ name: "postingDate", label: "Posting date", kind: "date" }], run: async (v) => { await run({ action: "post", postingDate: v.postingDate || undefined }); } })}>Post to Finance</Button>}
        {status === "posted" && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Unpost this payroll", confirm: "Reverse and cancel", tone: "danger",
          description: "The journal is reversed in Finance and this run is cancelled; run the period again for the corrected payroll.", fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }],
          run: async (v) => { await run({ action: "unpost", ...v }); } })}>Unpost</Button>}
        <Button size="compact" variant="secondary" onPress={() => { run({ action: "publish" }).catch(() => undefined); }}>Publish payslips</Button>
        {["posted", "partially_paid"].includes(status) && <Button size="compact" variant="primary" onPress={() => setAsk(payAsk())}>Record payment</Button>}
        {status === "paid" && <Button size="compact" variant="primary" onPress={() => { run({ action: "close" }).catch(() => undefined); }}>Close payroll</Button>}
      </span>}>
      {error && <Notice tone="danger">{error}</Notice>}
      <LinesTable columns={["Payslip", "Employee", { label: "Net", numeric: true }, { label: "Paid", numeric: true }, "Payment", "Published", ""]}>
        {d.slips.map((s) => <tr key={s.id}><Cell>{s.payslip_number}{s.status === "held" && <span className="block text-xs text-warning">On hold</span>}</Cell><Cell>{`${s.employee_number} · ${s.first_name} ${s.last_name ?? ""}`}</Cell>
          <Cell numeric>{money(s.net_pay)}</Cell><Cell numeric>{money(s.paid_amount)}</Cell>
          <Cell><StatusBadge tone={TONE[s.payment_status] ?? "neutral"}>{s.payment_status.replace(/_/g, " ").toLowerCase()}</StatusBadge>{s.payment_exception && <span className="block text-xs text-danger">{s.payment_exception}</span>}</Cell>
          <Cell>{s.published_at ? formatDateTime(s.published_at) : "—"}</Cell>
          <Cell>{["posted", "partially_paid"].includes(status) && s.payment_status !== "PAID" && s.status !== "held" && <span className="flex gap-1">
            <Button size="compact" variant="secondary" onPress={() => setAsk(payAsk(s))}>Pay</Button>
            <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Payment exception on ${s.payslip_number}`, confirm: "Mark", fields: [{ name: "reason", label: "What happened (e.g. the bank's rejection)", kind: "textarea", required: true }],
              run: async (v) => { await run({ action: "exception", payslipId: s.id, ...v }); } })}>Exception</Button></span>}</Cell></tr>)}
      </LinesTable>
      {d.payments.length > 0 && <LinesTable columns={["Payment", "Date", "Method", "Reference", { label: "Amount", numeric: true }]}>
        {d.payments.map((p) => <tr key={p.payment_number}><Cell>{p.payment_number}</Cell><Cell>{String(p.payment_date).slice(0, 10)}</Cell><Cell>{p.method.replace("_", " ")}</Cell><Cell>{p.reference ?? "—"}</Cell><Cell numeric>{money(p.amount)}</Cell></tr>)}
      </LinesTable>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}

export function PayrollReportsScreen() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [kind, setKind] = useState("payroll_register");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meta = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "payroll-accounting", "meta"), queryFn: () => call<{ banks: Option[]; reports: Option[]; challans: Array<Record<string, string>> }>(""), retry: false });
  const report = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "payroll-accounting", "report", kind, from, to),
    queryFn: () => call<{ title: string; rows: Array<Record<string, unknown>> }>(`?report=${kind}&from=${from}&to=${to}`), retry: false });
  const columns = report.data ? [...new Set(report.data.rows.flatMap((r) => Object.keys(r)))] : [];
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(v));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Payroll Reports" description="Read from the payslips, attendance, leave, payments and Finance's journals. Statutory deposits (challans) are recorded here and can't exceed what the month's payrolls owe."
        primaryAction={<Button variant="primary" onPress={() => setAsk({ title: "Record a statutory deposit", confirm: "Record",
          fields: [{ name: "kind", label: "What", kind: "select", required: true, initial: "tds", options: [{ value: "tds", label: "TDS" }, { value: "epf", label: "EPF" }, { value: "esi", label: "ESI" }, { value: "pt", label: "Professional Tax" }] },
            { name: "month", label: "Pay month (e.g. 2026-09)", kind: "text", required: true }, { name: "challanNumber", label: "Challan / TRRN number", kind: "text", required: true },
            { name: "paymentDate", label: "Paid on", kind: "date", required: true }, { name: "paidFromAccountId", label: "Paid from", kind: "select", required: true, options: meta.data?.banks ?? [] },
            { name: "amount", label: "Amount (empty: all that is owed)", kind: "quantity" }],
          run: async (v) => { setError(null); try { await call("", { method: "POST", body: JSON.stringify({ action: "statutory", ...v, amount: v.amount || undefined }) }); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr", "payroll-accounting") }); } catch (e) { setError(errorMessage(e)); throw e; } } })}>Record statutory deposit</Button>} />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Report" selectedKey={kind} onSelectionChange={(k) => setKind(String(k))} options={meta.data?.reports ?? [{ value: "payroll_register", label: "Payroll register" }]} />
        <TextField label="From month" value={from} onChange={setFrom} description="e.g. 2026-04" /><TextField label="To month" value={to} onChange={setTo} />
        <a className="self-center text-sm text-brand hover:underline" href={`/api/hr/payroll-accounting?report=${kind}&from=${from}&to=${to}&format=csv`}>Export CSV</a>
      </div>
      {report.isLoading ? <LoadingState label="Preparing the report" rows={3} /> : report.isError ? <Notice tone="danger">{errorMessage(report.error)}</Notice> : (
        <LinesTable columns={columns.map((c) => c.replace(/_/g, " "))} empty={report.data!.rows.length ? undefined : "Nothing to report."}>
          {report.data!.rows.map((r, i) => <tr key={i}>{columns.map((c) => <Cell key={c}>{show(r[c])}</Cell>)}</tr>)}
        </LinesTable>)}
      <Panel title="Statutory deposits">
        <LinesTable columns={["What", "Month", "Challan", "Paid on", { label: "Amount", numeric: true }]} empty={meta.data?.challans.length ? undefined : "None recorded."}>
          {(meta.data?.challans ?? []).map((c, i) => <tr key={i}><Cell>{String(c.kind).toUpperCase()}</Cell><Cell>{c.month}</Cell><Cell>{c.challan_number}</Cell><Cell>{String(c.payment_date).slice(0, 10)}</Cell><Cell numeric>{money(c.amount)}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
