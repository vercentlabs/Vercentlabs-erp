"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Option = { id: string; code?: string; name?: string; display_name?: string; functional_currency_code?: string; ledger_id?: string; is_group?: boolean; allow_manual_posting?: boolean };
type JournalLine = { key: string; accountId: string; description: string; debit: string; credit: string; partyId: string; branchId: string; departmentId: string; costCenterId: string };
const newLine = (): JournalLine => ({ key: crypto.randomUUID(), accountId: "", description: "", debit: "", credit: "", partyId: "", branchId: "", departmentId: "", costCenterId: "" });
const number = (value: string) => Number(value || 0);

export default function JournalEditor({ companyId, baseCurrency, ledgers, journals, accounts, parties, branches, departments, costCenters }: { companyId: string; baseCurrency: string; ledgers: Option[]; journals: Option[]; accounts: Option[]; parties: Option[]; branches: Option[]; departments: Option[]; costCenters: Option[] }) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [accountingDate, setAccountingDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [ledgerId, setLedgerId] = useState(ledgers[0]?.id || "");
  const filteredJournals = journals.filter((row) => !row.ledger_id || row.ledger_id === ledgerId);
  const [journalId, setJournalId] = useState(filteredJournals[0]?.id || journals[0]?.id || "");
  const [lines, setLines] = useState<JournalLine[]>([newLine(), newLine()]);
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const totals = useMemo(() => lines.reduce((sum, line) => ({ debit: sum.debit + number(line.debit), credit: sum.credit + number(line.credit) }), { debit: 0, credit: 0 }), [lines]);
  function patchLine(key: string, field: keyof JournalLine, value: string) { setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line)); }
  async function submit() {
    setError("");
    if (!description || !journalId || lines.some((line) => !line.accountId || (number(line.debit) > 0) === (number(line.credit) > 0))) { setError("Complete the header and enter one debit or credit on every line."); return; }
    if (Math.abs(totals.debit - totals.credit) > 0.000001) { setError("The journal must balance before it can be saved."); return; }
    setPending(true);
    try {
      const response = await fetch("/api/accounting/journals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, ledgerId, journalId, accountingDate, description, reference: reference || null, currencyCode: baseCurrency, lines: lines.map((line) => ({ accountId: line.accountId, description: line.description, partyId: line.partyId || null, branchId: line.branchId || null, departmentId: line.departmentId || null, costCenterId: line.costCenterId || null, debit: line.debit || 0, credit: line.credit || 0 })) }) });
      const payload = await response.json() as { ok?: boolean; message?: string; journal?: { entry?: { id?: string } } };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Journal could not be created.");
      router.push(`/accounting/journals/${String(payload.journal?.entry?.id || "")}`); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Journal could not be created."); }
    finally { setPending(false); }
  }
  const postingAccounts = accounts.filter((row) => !row.is_group && row.allow_manual_posting !== false && (!row.ledger_id || row.ledger_id === ledgerId));
  return <div className="accounting-editor">
    <section className="panel accounting-document-header"><div><p className="eyebrow">Journal header</p><h2>Accounting details</h2></div><div className="accounting-form-grid">
      <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>Accounting date<input type="date" value={accountingDate} onChange={(event) => setAccountingDate(event.target.value)} /></label>
      <label>Ledger<select value={ledgerId} onChange={(event) => { setLedgerId(event.target.value); const next = journals.find((row) => row.ledger_id === event.target.value); if (next) setJournalId(next.id); }}>{ledgers.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
      <label>Journal<select value={journalId} onChange={(event) => setJournalId(event.target.value)}>{filteredJournals.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
      <label>Reference<input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      <label>Currency<input value={baseCurrency} disabled /></label>
    </div></section>
    <section className="panel"><div className="accounting-section-heading"><div><p className="eyebrow">Double entry</p><h2>Journal lines</h2></div><button className="secondary-button" type="button" onClick={() => setLines((current) => [...current, newLine()])}>Add line</button></div>
      <div className="accounting-line-grid accounting-line-head"><span>Account</span><span>Description</span><span>Party</span><span>Cost centre</span><span>Debit</span><span>Credit</span><span /></div>
      {lines.map((line) => <div className="accounting-line-grid" key={line.key}>
        <select value={line.accountId} onChange={(event) => patchLine(line.key, "accountId", event.target.value)}><option value="">Select account</option>{postingAccounts.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select>
        <input value={line.description} onChange={(event) => patchLine(line.key, "description", event.target.value)} />
        <select value={line.partyId} onChange={(event) => patchLine(line.key, "partyId", event.target.value)}><option value="">No party</option>{parties.map((row) => <option key={row.id} value={row.id}>{row.display_name || row.name}</option>)}</select>
        <select value={line.costCenterId} onChange={(event) => patchLine(line.key, "costCenterId", event.target.value)}><option value="">No cost centre</option>{costCenters.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select>
        <input inputMode="decimal" value={line.debit} onChange={(event) => patchLine(line.key, "debit", event.target.value)} />
        <input inputMode="decimal" value={line.credit} onChange={(event) => patchLine(line.key, "credit", event.target.value)} />
        <button className="icon-button" aria-label="Remove line" type="button" disabled={lines.length <= 2} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>×</button>
      </div>)}
      <div className="accounting-totals"><span>Total</span><strong>{baseCurrency} {totals.debit.toFixed(2)}</strong><strong>{baseCurrency} {totals.credit.toFixed(2)}</strong><b className={Math.abs(totals.debit - totals.credit) < 0.000001 ? "balanced" : "unbalanced"}>{Math.abs(totals.debit - totals.credit) < 0.000001 ? "Balanced" : `Difference ${Math.abs(totals.debit - totals.credit).toFixed(2)}`}</b></div>
      {error ? <p className="form-error">{error}</p> : null}<div className="accounting-editor-actions"><button className="primary-button" type="button" disabled={pending} onClick={submit}>{pending ? "Saving…" : "Save draft journal"}</button></div>
    </section>
    <datalist id="branches">{branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</datalist><datalist id="departments">{departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</datalist>
  </div>;
}
