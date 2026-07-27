"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { id: string; code?: string; name?: string; journal_type?: string; is_group?: boolean };

export default function RecurringEditor({ companyId, baseCurrency, journals, accounts }: { companyId: string; baseCurrency: string; journals: Option[]; accounts: Option[] }) {
  const router = useRouter(); const posting = accounts.filter((account) => !account.is_group); const general = journals.find((journal) => journal.journal_type === "general") || journals[0];
  const [message, setMessage] = useState(""); const [pending, setPending] = useState(false);
  async function submit(formData: FormData) {
    setPending(true); setMessage("");
    try {
      const amount = String(formData.get("amount") || "0");
      const payload = { companyId, journalId: String(formData.get("journalId") || general?.id || ""), code: String(formData.get("code") || ""), name: String(formData.get("name") || ""), frequency: String(formData.get("frequency") || "monthly"), nextRunDate: String(formData.get("nextRunDate") || ""), autoPost: formData.get("autoPost") === "on", description: String(formData.get("description") || ""), currencyCode: baseCurrency, lines: [{ accountId: String(formData.get("debitAccountId") || ""), debit: amount, credit: 0 }, { accountId: String(formData.get("creditAccountId") || ""), debit: 0, credit: amount }] };
      const response = await fetch("/api/accounting/recurring", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({})) as { message?: string }; if (!response.ok) throw new Error(result.message || "Recurring template creation failed."); setMessage("Recurring template created."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Recurring template creation failed."); } finally { setPending(false); }
  }
  return <form className="panel accounting-form" action={submit}><div><p className="eyebrow">Automation</p><h2>Recurring journal template</h2><p>Schedule a balanced journal and optionally post it automatically.</p></div><div className="accounting-form-grid"><label>Code<input name="code" required /></label><label>Name<input name="name" required /></label><label>Journal<select name="journalId" defaultValue={general?.id}>{journals.map((journal) => <option key={journal.id} value={journal.id}>{journal.code} · {journal.name}</option>)}</select></label><label>Frequency<select name="frequency"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="half_yearly">Half yearly</option><option value="yearly">Yearly</option></select></label><label>Next run<input name="nextRunDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Amount<input name="amount" type="number" required /></label><label>Debit account<select name="debitAccountId">{posting.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label><label>Credit account<select name="creditAccountId">{posting.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label><label>Description<input name="description" required /></label><label>Auto post<input name="autoPost" type="checkbox" /></label></div><div className="accounting-form-actions"><button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Create recurring template"}</button>{message ? <span>{message}</span> : null}</div></form>;
}
