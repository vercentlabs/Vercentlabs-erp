"use client";

// Finance › Tax & GST: GST returns (GSTR-1 working papers by GSTIN and month: prepare → review exceptions → approve → export → record the
// filing) and the outward / inward GST summaries. The working data is not the portal's offline-tool file, and nothing is filed from here.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, MetricStrip, PageHeader, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { errorMessage } from "@/features/quality/specifications/spec-api";
import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Registration = { id: string; name: string; gstin: string; state_code: string; status: string; is_default: boolean };
type Totals = { taxable: number; igst: number; cgst: number; sgst: number; utgst: number; cess: number; documents?: number };
type GstReturn = { id: string; returnType: string; registrationId: string; gstin: string; period: string; status: string; label: string | null; filingReference: string | null; filedOn: string | null;
  summary: { sections?: Record<string, Totals>; liability?: Totals; docs?: Array<{ nature: string; from: string | null; to: string | null; total: number; cancelled: number }>;
    exceptions?: { blocking: number; warning: number }; unsupported?: string[]; [k: string]: unknown };
  reconciliation: { ledgerAgrees?: boolean; ledgerDifference?: number; glAgrees?: boolean | null; glDifference?: number | null; glNote?: string; [k: string]: unknown } };
type Exception = { id: string; code: string; severity: string; status: string; document_number: string | null; message: string; note: string | null; decided_by: string | null };
type Detail = GstReturn & { exceptions: Exception[]; rows: Array<Record<string, string | number | null>>; hsn: Array<Record<string, string | number | null>>; canApprove: boolean;
  sections: Record<string, string> };

async function call<T>(query: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/accounting/gst${query}`, { credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "The request could not be completed.");
  return payload as T;
}
const post = (body: Record<string, unknown>) => call<GstReturn>("", { method: "POST", body: JSON.stringify(body) });
const money = (n: number | string | null | undefined) => `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { DRAFT: "neutral", PREPARED: "warning", APPROVED: "info", FILED: "success",
  open: "warning", waived: "neutral", blocking: "danger", warning: "warning" };
const lastMonth = () => { const d = new Date(); d.setDate(0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export function GstReturnsScreen() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const router = useRouter();
  const [registrationId, setRegistrationId] = useState<string>("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = scopedQueryKey(workspace, "accounting", "gst", registrationId);
  const q = useQuery({ queryKey: key, queryFn: () => call<{ registrations: Registration[]; returns: GstReturn[] }>(registrationId ? `?registrationId=${registrationId}` : ""), retry: false });
  const regs = q.data?.registrations ?? [];
  const chosen = registrationId || regs.find((r) => r.is_default)?.id || regs[0]?.id || "";
  const prepareAsk: Ask = { title: "Prepare GSTR-1", confirm: "Prepare", description: "Collects the month's posted invoices, credit and debit notes and POS invoices of this GSTIN, checks each one and reconciles the tax with Finance.",
    fields: [{ name: "period", label: "Month (YYYY-MM)", kind: "text", initial: lastMonth(), required: true }],
    run: async (v) => { setError(null); try { const r = await post({ action: "prepare", registrationId: chosen, period: v.period }); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting", "gst") }); router.replace(`/accounting/gst-returns/${r.id}`); } catch (e) { setError(errorMessage(e)); throw e; } } };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="GST Returns" description="Return working papers for each company GSTIN and month: prepared from what was issued and posted, checked, reconciled with Finance, approved by a second person and recorded as filed. Data is prepared here; filing happens on the GST portal."
        primaryAction={<span className="flex flex-wrap gap-2">
          <Button variant="primary" isDisabled={!chosen} onPress={() => setAsk(prepareAsk)}>Prepare GSTR-1</Button>
          <Button variant="secondary" isDisabled={!chosen} onPress={() => setAsk({ ...prepareAsk, title: "Prepare GSTR-3B", description: "Outward liability from the documents issued, input tax credit confirmed claimable, reversals and reclaims; reconciled with GSTR-1, GSTR-2B and the GL.",
            run: async (v) => { setError(null); try { const r = await post({ action: "prepare3b", registrationId: chosen, period: v.period }); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting", "gst") }); router.replace(`/accounting/gst-returns/${r.id}`); } catch (e) { setError(errorMessage(e)); throw e; } } })}>Prepare GSTR-3B</Button>
          <Link className="self-center text-sm text-brand hover:underline" href="/accounting/gst-2b">GSTR-2B and credit</Link></span>} />
      {error && <Notice tone="danger">{error}</Notice>}
      {regs.length > 1 && <Select label="GSTIN" selectedKey={chosen} onSelectionChange={(k) => setRegistrationId(String(k))} options={regs.map((r) => ({ value: r.id, label: `${r.gstin} · ${r.name}` }))} />}
      {q.isLoading ? <LoadingState label="Loading returns" rows={3} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : !regs.length
        ? <Notice tone="warning">Add the company&apos;s GST registration with its GSTIN in Settings › Taxes first.</Notice>
        : <LinesTable columns={["Return", "Month", "GSTIN", "Status", "Where it stands", { label: "Taxable", numeric: true }, { label: "Tax", numeric: true }, "Exceptions"]} empty={q.data!.returns.length ? undefined : "No returns prepared yet."}>
          {q.data!.returns.map((r) => { const t = r.summary.liability; return <tr key={r.id}>
            <Cell><Link className="text-brand hover:underline" href={`/accounting/gst-returns/${r.id}`}>{r.returnType === "GSTR1" ? "GSTR-1" : "GSTR-3B"}</Link></Cell><Cell>{r.period}</Cell><Cell>{r.gstin}</Cell>
            <Cell><StatusBadge tone={TONE[r.status] ?? "neutral"}>{r.status.toLowerCase()}</StatusBadge></Cell><Cell>{r.label ?? "—"}</Cell>
            <Cell numeric>{t ? money(t.taxable) : "—"}</Cell><Cell numeric>{t ? money(t.igst + t.cgst + t.sgst + t.utgst + t.cess) : "—"}</Cell>
            <Cell>{r.summary.exceptions ? `${r.summary.exceptions.blocking} blocking · ${r.summary.exceptions.warning} to review` : "—"}</Cell></tr>; })}
        </LinesTable>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

const SECTION_ORDER = ["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exp", "nil", "hsn", "docs"];
export function GstReturnScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [section, setSection] = useState("b2b");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "gst", "return", id, section), queryFn: () => call<Detail>(`?id=${id}&section=${section}`), retry: false });
  if (q.isLoading) return <LoadingState label="Loading the return" rows={4} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const r = q.data!;
  const run = async (body: Record<string, unknown>) => { setError(null); try { await post({ id, ...body }); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting", "gst") }); } catch (e) { setError(errorMessage(e)); throw e; } };
  const t = r.summary.liability ?? { taxable: 0, igst: 0, cgst: 0, sgst: 0, utgst: 0, cess: 0 };
  const open = r.exceptions.filter((x) => x.status === "open");
  const rec = r.reconciliation;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${r.returnType === "GSTR3B" ? "GSTR-3B" : "GSTR-1"} · ${r.period}`} description={`${r.gstin} · ${r.label ?? r.status.toLowerCase()}${r.filingReference ? ` · ARN ${r.filingReference} (${r.filedOn})` : ""}`}
        primaryAction={<span className="flex flex-wrap gap-2">
          {["DRAFT", "PREPARED"].includes(r.status) && <Button variant="secondary" onPress={() => { run({ action: r.returnType === "GSTR3B" ? "prepare3b" : "prepare", registrationId: r.registrationId, period: r.period }).catch(() => undefined); }}>Prepare again</Button>}
          {r.status === "PREPARED" && r.canApprove && <Button variant="primary" isDisabled={(r.summary.exceptions?.blocking ?? 0) > 0} onPress={() => { run({ action: "approve" }).catch(() => undefined); }}>Approve</Button>}
          {r.status === "APPROVED" && <>
            <Button variant="primary" onPress={() => setAsk({ title: "Record the filing", confirm: "Record", description: "After filing GSTR-1 on the GST portal: its acknowledgement reference and date. The return is then final; later corrections are amendments.",
              fields: [{ name: "reference", label: "ARN", kind: "text", required: true }, { name: "filedOn", label: "Filed on", kind: "date", required: true }], run: async (v) => { await run({ action: "file", ...v }); } })}>Record filing</Button>
            <Button variant="ghost" onPress={() => setAsk({ title: "Reopen the return", confirm: "Reopen", fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: async (v) => { await run({ action: "reopen", ...v }); } })}>Reopen</Button></>}
        </span>} />
      {error && <Notice tone="danger">{error}</Notice>}
      {r.returnType === "GSTR3B" ? <Gstr3bBody r={r} /> : <>
      <MetricStrip metrics={[{ label: "Taxable value", value: money(t.taxable) }, { label: "IGST", value: money(t.igst) }, { label: "CGST", value: money(t.cgst) },
        { label: "SGST / UTGST", value: money(t.sgst + t.utgst) }, { label: "Cess", value: money(t.cess) }, { label: "Blocking", value: String(r.summary.exceptions?.blocking ?? 0) }]} />
      <Panel title="Reconciliation" description="The tax on the reported documents against Finance's tax ledger for the same documents, and against the GL's output-tax accounts for the month.">
        <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <div><dt className="text-text-muted">Finance tax ledger</dt><dd>{rec.ledgerAgrees ? "Agrees" : `Differs by ${money(rec.ledgerDifference)}`}</dd></div>
          <div><dt className="text-text-muted">GL output-tax accounts</dt><dd>{rec.glAgrees === null || rec.glAgrees === undefined ? rec.glNote : rec.glAgrees ? "Agrees" : `Differs by ${money(rec.glDifference)}`}</dd></div>
        </dl>
      </Panel></>}
      <Panel title={`Exceptions (${open.length} open)`} description="Blocking ones are fixed at the source document, then the return is prepared again. Warnings are reviewed and can be accepted with a reason.">
        {r.exceptions.length === 0 ? <p className="text-sm text-text-muted">None.</p> : <LinesTable columns={["Document", "Problem", "Status", ""]}>
          {r.exceptions.map((x) => <tr key={x.id}><Cell>{x.document_number ?? "—"}</Cell><Cell><StatusBadge tone={TONE[x.severity]}>{x.severity}</StatusBadge> {x.message}</Cell>
            <Cell>{x.status}{x.note && <span className="block text-xs text-text-muted">{x.note}{x.decided_by ? ` — ${x.decided_by}` : ""}</span>}</Cell>
            <Cell>{x.status === "open" && x.severity === "warning" && ["DRAFT", "PREPARED"].includes(r.status) && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Accept the warning", confirm: "Accept",
              fields: [{ name: "note", label: "Why it is fine", kind: "textarea", required: true }], run: async (v) => { await run({ action: "waive", exceptionId: x.id, ...v }); } })}>Accept</Button>}</Cell></tr>)}
        </LinesTable>}
      </Panel>
      {r.returnType === "GSTR1" && <Panel title="Sections" description="Working data for each table. The CSV is not the portal's offline-tool file." actions={<a className="text-sm text-brand hover:underline" href={`/api/accounting/gst?id=${id}&export=${section}`}>Export {section.toUpperCase()} CSV</a>}>
        <div className="flex flex-wrap gap-2">{SECTION_ORDER.map((s) => <Button key={s} size="compact" variant={section === s ? "primary" : "secondary"} onPress={() => setSection(s)}>
          {`${s.toUpperCase()} (${r.summary.sections?.[s]?.documents ?? 0})`}</Button>)}</div>
        <p className="text-sm text-text-muted">{r.sections[section]}</p>
        {section === "docs" ? <LinesTable columns={["Nature", "From", "To", "Total", "Cancelled"]}>{(r.summary.docs ?? []).map((d) => <tr key={d.nature}><Cell>{d.nature}</Cell><Cell>{d.from ?? "—"}</Cell><Cell>{d.to ?? "—"}</Cell><Cell>{d.total}</Cell><Cell>{d.cancelled}</Cell></tr>)}</LinesTable>
          : section === "hsn" ? <LinesTable columns={["B2B / B2C", "HSN / SAC", "UQC", { label: "Quantity", numeric: true }, "Rate", { label: "Taxable", numeric: true }, { label: "Tax", numeric: true }]}>
            {r.hsn.map((h, i) => <tr key={i}><Cell>{String(h.recipient).toUpperCase()}</Cell><Cell>{h.hsn_sac}</Cell><Cell>{h.uqc}</Cell><Cell numeric>{Number(h.quantity)}</Cell><Cell>{`${Number(h.rate)}%`}</Cell>
              <Cell numeric>{money(h.taxable)}</Cell><Cell numeric>{money(Number(h.igst) + Number(h.cgst) + Number(h.sgst) + Number(h.utgst) + Number(h.cess))}</Cell></tr>)}</LinesTable>
          : <LinesTable columns={["Document", "Date", "Recipient", "Place of supply", "Rate", { label: "Taxable", numeric: true }, { label: "IGST", numeric: true }, { label: "CGST", numeric: true }, { label: "SGST / UTGST", numeric: true }, { label: "Cess", numeric: true }]}
              empty={r.rows.length ? undefined : "Nothing in this section."}>
            {r.rows.map((d) => <tr key={String(d.id)}><Cell>{`${d.document_number}${d.document_type !== "invoice" ? ` (${String(d.document_type).replace("_", " ")})` : ""}`}</Cell><Cell>{String(d.document_date).slice(0, 10)}</Cell>
              <Cell>{d.counterparty_gstin ?? "Unregistered"}</Cell><Cell>{d.place_of_supply ?? "—"}</Cell><Cell>{section === "nil" ? String(d.classification).replace("_", " ") : `${Number(d.rate)}%`}</Cell>
              <Cell numeric>{money(d.taxable)}</Cell><Cell numeric>{money(d.igst)}</Cell><Cell numeric>{money(d.cgst)}</Cell><Cell numeric>{money(Number(d.sgst) + Number(d.utgst))}</Cell><Cell numeric>{money(d.cess)}</Cell></tr>)}
          </LinesTable>}
        {r.summary.unsupported && <p className="text-xs text-text-muted">Not prepared here: {r.summary.unsupported.join("; ")}.</p>}
      </Panel>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

type SummaryRow = Totals & { month: string; classification: string; itcStatus?: string; documents: number };
export function GstSummaryScreen() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState<"outward" | "inward">("outward");
  const [from, setFrom] = useState(lastMonth());
  const [to, setTo] = useState(lastMonth());
  const [registrationId, setRegistrationId] = useState("");
  const regs = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "gst", "registrations"), queryFn: () => call<{ registrations: Registration[] }>(""), retry: false });
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "gst", "summary", kind, from, to, registrationId),
    queryFn: () => call<{ gstin: string; rows: SummaryRow[]; total?: Totals; claimable?: Totals; pending?: Totals; notClaimable?: Totals }>(`?summary=${kind}&from=${from}&to=${to}${registrationId ? `&registrationId=${registrationId}` : ""}`), retry: false });
  const tax = (r: Totals) => r.igst + r.cgst + r.sgst + r.utgst + r.cess;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="GST Summary" description="Outward: what was issued, by month, classification and tax head. Inward: supplier invoices and expenses from Finance's tax ledger — supplier GST is credit only once confirmed." />
      <div className="flex flex-wrap items-end gap-2">
        <Button variant={kind === "outward" ? "primary" : "secondary"} onPress={() => setKind("outward")}>Outward</Button>
        <Button variant={kind === "inward" ? "primary" : "secondary"} onPress={() => setKind("inward")}>Inward</Button>
        {(regs.data?.registrations.length ?? 0) > 1 && <Select label="GSTIN" selectedKey={registrationId || regs.data!.registrations[0].id} onSelectionChange={(k) => setRegistrationId(String(k))}
          options={regs.data!.registrations.map((r) => ({ value: r.id, label: r.gstin }))} />}
        <TextField label="From month" value={from} onChange={setFrom} /><TextField label="To month" value={to} onChange={setTo} />
      </div>
      {q.isLoading ? <LoadingState label="Preparing the summary" rows={3} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : <>
        {kind === "inward" && <MetricStrip metrics={[{ label: "Claimable credit", value: money(tax(q.data!.claimable!)) }, { label: "Awaiting confirmation", value: money(tax(q.data!.pending!)) },
          { label: "Not claimable", value: money(tax(q.data!.notClaimable!)) }]} />}
        <LinesTable columns={["Month", "Classification", ...(kind === "inward" ? ["Credit"] : []), { label: "Documents", numeric: true }, { label: "Taxable", numeric: true }, { label: "IGST", numeric: true }, { label: "CGST", numeric: true },
          { label: "SGST / UTGST", numeric: true }, { label: "Cess", numeric: true }]} empty={q.data!.rows.length ? undefined : "Nothing in these months."}>
          {q.data!.rows.map((r, i) => <tr key={i}><Cell>{r.month}</Cell><Cell>{r.classification.replace(/_/g, " ")}</Cell>{kind === "inward" && <Cell>{String(r.itcStatus ?? "").toLowerCase().replace("_", " ")}</Cell>}
            <Cell numeric>{r.documents}</Cell><Cell numeric>{money(r.taxable)}</Cell><Cell numeric>{money(r.igst)}</Cell><Cell numeric>{money(r.cgst)}</Cell><Cell numeric>{money(r.sgst + r.utgst)}</Cell><Cell numeric>{money(r.cess)}</Cell></tr>)}
        </LinesTable></>}
    </div>
  );
}

type Heads = { taxable?: number; igst: number; cgst: number; sgst: number; cess: number };
function Gstr3bBody({ r }: { r: Detail }) {
  const s = r.summary as unknown as { table31: Record<string, Heads>; table32: Array<{ pos: string | null; taxable: number; igst: number }>; table4: Record<string, Heads>;
    table5: { nilExempt: number; nonGst: number }; payable: Heads; rcmCash: Heads; notes: string[]; twoB: { lines: number; matched: number; mismatch: number; notInBooks: number } | null;
    gstr1: { status: string } | null; gl: Heads | null; glNote: string | null };
  const sum = (h: Heads) => h.igst + h.cgst + h.sgst + h.cess;
  const row = (label: string, h?: Heads) => <tr key={label}><Cell>{label}</Cell><Cell numeric>{h?.taxable === undefined ? "" : money(h.taxable)}</Cell><Cell numeric>{money(h?.igst)}</Cell>
    <Cell numeric>{money(h?.cgst)}</Cell><Cell numeric>{money(h?.sgst)}</Cell><Cell numeric>{money(h?.cess)}</Cell></tr>;
  const cols = ["", { label: "Taxable", numeric: true }, { label: "IGST", numeric: true }, { label: "CGST", numeric: true }, { label: "SGST / UTGST", numeric: true }, { label: "Cess", numeric: true }];
  return <>
    <MetricStrip metrics={[{ label: "Outward tax", value: money(sum(s.table31.a) + sum(s.table31.b)) }, { label: "Net credit (4C)", value: money(sum(s.table4.net)) },
      { label: "Payable before set-off", value: money(sum(s.payable)) }, { label: "Reverse charge (cash)", value: money(sum(s.rcmCash)) }]} />
    <Panel title="3.1 Outward and reverse-charge supplies" actions={<a className="text-sm text-brand hover:underline" href={`/api/accounting/gst?id=${r.id}&export=3b`}>Export working paper CSV</a>}>
      <LinesTable columns={cols}>{[row("(a) Taxable (other than zero, nil, exempt)", s.table31.a), row("(b) Zero-rated", s.table31.b), row("(c) Nil-rated and exempt", s.table31.c),
        row("(d) Inward liable to reverse charge", s.table31.d), row("(e) Non-GST", s.table31.e)]}</LinesTable>
      {s.table32.length > 0 && <LinesTable columns={["3.2 Inter-state to unregistered — place of supply", { label: "Taxable", numeric: true }, { label: "IGST", numeric: true }]}>
        {s.table32.map((x) => <tr key={String(x.pos)}><Cell>{x.pos ?? "—"}</Cell><Cell numeric>{money(x.taxable)}</Cell><Cell numeric>{money(x.igst)}</Cell></tr>)}</LinesTable>}
    </Panel>
    <Panel title="4 Input tax credit" description="Only credit confirmed claimable counts; supplier GST still awaiting confirmation is left out.">
      <LinesTable columns={cols}>{[row("(A)(3) Inward liable to reverse charge", s.table4.a3), row("(A)(5) All other ITC", s.table4.a5), row("(B)(1) Reversed: Rules 38, 42, 43, s.17(5)", s.table4.b1),
        row("(B)(2) Reversed: others (reclaimable)", s.table4.b2), row("(C) Net ITC available", s.table4.net), row("(D)(1) Reclaimed", s.table4.d1), row("(D)(2) Ineligible", s.table4.d2)]}</LinesTable>
    </Panel>
    <Panel title="Payable and reconciliation">
      <LinesTable columns={cols}>{[row("Tax payable before cross-utilisation", s.payable), row("Reverse-charge tax, in cash", s.rcmCash)]}</LinesTable>
      <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
        <div><dt className="text-text-muted">GSTR-1 of the month</dt><dd>{s.gstr1 ? s.gstr1.status.toLowerCase() : "not prepared"}</dd></div>
        <div><dt className="text-text-muted">GSTR-2B</dt><dd>{s.twoB ? `${s.twoB.matched} matched · ${s.twoB.mismatch} differ · ${s.twoB.notInBooks} not in books` : "not imported"}</dd></div>
        <div><dt className="text-text-muted">GL input-tax accounts</dt><dd>{s.gl ? money(sum(s.gl)) : s.glNote}</dd></div>
      </dl>
      <p className="text-xs text-text-muted">{`5 Exempt / nil inward ${money(s.table5.nilExempt)} · non-GST inward ${money(s.table5.nonGst)}. ${s.notes.join(" ")}`}</p>
    </Panel>
  </>;
}

type TwoBLine = { id: string; supplier_gstin: string; supplier_name: string | null; document_number: string; document_date: string | null; taxable: string; igst: string; cgst: string; sgst: string; cess: string;
  match_status: string; book_number: string | null; difference: Record<string, number> | null; itc_available: boolean };
type TwoB = { gstin: string; period: string; imported: { fileName: string | null; rows: number; skipped: Array<{ row: number; reason: string }>; importedAt: string; importedBy: string | null } | null;
  counts: { matched: number; mismatch: number; notInBooks: number; notIn2b: number }; lines: TwoBLine[];
  notIn2b: Array<{ sourceId: string; number: string; supplierNumber: string | null; gstin: string | null; date: string | null; tax: number; itcStatus: string }>; canImport: boolean;
  adjustments: { rows: Array<{ id: string; kind: string; month: string; reasonLabel: string; reclaimable: boolean; reclaimed: boolean; igst: string; cgst: string; sgst: string; cess: string; note: string; bill_number: string | null }>;
    reasons: Array<{ value: string; label: string; reclaimable: boolean | null }> } };
const MATCH: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { matched: "success", mismatch: "warning", not_in_books: "danger", pending: "neutral" };
export function Gstr2bScreen() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [period, setPeriod] = useState(lastMonth());
  const [registrationId, setRegistrationId] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const regs = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "gst", "registrations"), queryFn: () => call<{ registrations: Registration[] }>(""), retry: false });
  const key = scopedQueryKey(workspace, "accounting", "gst", "2b", period, registrationId);
  const q = useQuery({ queryKey: key, queryFn: () => call<TwoB>(`?twoB=1&period=${period}${registrationId ? `&registrationId=${registrationId}` : ""}`), retry: false });
  const run = async (body: Record<string, unknown>) => { setError(null); try { await call("", { method: "POST", body: JSON.stringify({ ...body, registrationId: registrationId || undefined }) }); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting", "gst") }); } catch (e) { setError(errorMessage(e)); throw e; } };
  const upload = async (file: File | undefined) => { if (!file) return; const csv = await file.text(); await run({ action: "import2b", period, fileName: file.name, csv }).catch(() => undefined); };
  const d = q.data;
  const sumOf = (a: { igst: string; cgst: string; sgst: string; cess: string }) => Number(a.igst) + Number(a.cgst) + Number(a.sgst) + Number(a.cess);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="GSTR-2B and Credit" description="What suppliers reported for the month (GSTR-2B, imported from the portal as CSV), matched with the supplier invoices in the books; credit confirmed from matches; and credit reversed or reclaimed."
        primaryAction={<span className="flex flex-wrap items-end gap-2">
          {(regs.data?.registrations.length ?? 0) > 1 && <Select label="GSTIN" selectedKey={registrationId || regs.data!.registrations[0].id} onSelectionChange={(k) => setRegistrationId(String(k))}
            options={regs.data!.registrations.map((r) => ({ value: r.id, label: r.gstin }))} />}
          <TextField label="Month (YYYY-MM)" value={period} onChange={setPeriod} />
          {d?.canImport && <label className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm">Import GSTR-2B CSV<input className="hidden" type="file" accept=".csv,text/csv" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>}
          {d?.canImport && (d.counts.matched > 0) && <Button variant="primary" onPress={() => { run({ action: "confirm2b", period }).catch(() => undefined); }}>Confirm matched credit</Button>}
        </span>} />
      {error && <Notice tone="danger">{error}</Notice>}
      {q.isLoading ? <LoadingState label="Loading GSTR-2B" rows={3} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : <>
        <MetricStrip metrics={[{ label: "Matched", value: String(d!.counts.matched) }, { label: "Amounts differ", value: String(d!.counts.mismatch) }, { label: "Not in books", value: String(d!.counts.notInBooks) },
          { label: "In books, not in 2B", value: String(d!.counts.notIn2b) }]} />
        {!d!.imported ? <Notice tone="warning">No GSTR-2B imported for {d!.period}. Download it from the portal (Returns › GSTR-2B › B2B, as CSV / Excel saved as CSV) and import it.</Notice>
          : <p className="text-sm text-text-muted">{`${d!.imported.fileName ?? "File"} · ${d!.imported.rows} rows${d!.imported.skipped.length ? ` · ${d!.imported.skipped.length} skipped (${d!.imported.skipped.slice(0, 3).map((x) => `row ${x.row}: ${x.reason}`).join("; ")})` : ""}`}</p>}
        {d!.lines.length > 0 && <LinesTable columns={["Supplier", "Invoice", "Date", { label: "Taxable", numeric: true }, { label: "Tax", numeric: true }, "Match", "In the books"]}>
          {d!.lines.map((l) => <tr key={l.id}><Cell>{`${l.supplier_gstin}${l.supplier_name ? ` · ${l.supplier_name}` : ""}`}</Cell><Cell>{l.document_number}</Cell><Cell>{l.document_date ? String(l.document_date).slice(0, 10) : "—"}</Cell>
            <Cell numeric>{money(l.taxable)}</Cell><Cell numeric>{money(sumOf(l))}</Cell><Cell><StatusBadge tone={MATCH[l.match_status] ?? "neutral"}>{l.match_status.replace(/_/g, " ")}</StatusBadge>
              {l.difference && <span className="block text-xs text-text-muted">{Object.entries(l.difference).map(([k, v]) => `${k.toUpperCase()} ${v > 0 ? "+" : ""}${v}`).join(", ")}</span>}</Cell>
            <Cell>{l.book_number ?? "—"}</Cell></tr>)}
        </LinesTable>}
        {d!.notIn2b.length > 0 && <Panel title="In the books, not in GSTR-2B" description="Credit on these is not confirmed from 2B. Follow up with the supplier or decide it in Input Tax Credit.">
          <LinesTable columns={["Document", "Supplier invoice", "Supplier GSTIN", "Date", { label: "GST", numeric: true }, "Credit"]}>
            {d!.notIn2b.map((b) => <tr key={b.sourceId}><Cell>{b.number}</Cell><Cell>{b.supplierNumber ?? "—"}</Cell><Cell>{b.gstin ?? "—"}</Cell><Cell>{b.date ?? "—"}</Cell><Cell numeric>{money(b.tax)}</Cell><Cell>{b.itcStatus.toLowerCase()}</Cell></tr>)}
          </LinesTable></Panel>}
        <Panel title="Credit reversed and reclaimed" description="Posted to Finance once each; they appear in GSTR-3B tables 4(B) and 4(D)(1)."
          actions={d!.canImport && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Reverse input tax credit", confirm: "Reverse", tone: "danger",
            description: `Reported in the GSTR-3B for ${period}. A reclaimable reversal (Rule 37) can be brought back later, once.`,
            fields: [{ name: "reasonCode", label: "Why", kind: "select", required: true, options: d!.adjustments.reasons }, { name: "igst", label: "IGST", kind: "quantity" }, { name: "cgst", label: "CGST", kind: "quantity" },
              { name: "sgst", label: "SGST / UTGST", kind: "quantity" }, { name: "cess", label: "Cess", kind: "quantity" }, { name: "note", label: "Working / invoices", kind: "textarea", required: true }],
            run: async (v) => { await run({ action: "reverseItc", period, ...v, idempotencyKey: crypto.randomUUID() }); } })}>Reverse credit</Button>}>
          <LinesTable columns={["Month", "What", { label: "GST", numeric: true }, "Note", ""]} empty={d!.adjustments.rows.length ? undefined : "None."}>
            {d!.adjustments.rows.map((a) => <tr key={a.id}><Cell>{a.month}</Cell><Cell>{`${a.kind === "reclaim" ? "Reclaim" : "Reversal"} · ${a.reasonLabel}${a.bill_number ? ` · ${a.bill_number}` : ""}`}</Cell>
              <Cell numeric>{money(sumOf(a))}</Cell><Cell>{a.note}</Cell>
              <Cell>{d!.canImport && a.kind === "reversal" && a.reclaimable && !a.reclaimed && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Reclaim the credit", confirm: "Reclaim",
                fields: [{ name: "period", label: "Month reclaimed (YYYY-MM)", kind: "text", required: true, initial: period }, { name: "note", label: "Why it can be reclaimed", kind: "textarea", required: true }],
                run: async (v) => { await run({ action: "reclaimItc", reversalId: a.id, ...v }); } })}>Reclaim</Button>}</Cell></tr>)}
          </LinesTable>
        </Panel></>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
