"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Account = { id: string; code?: string; name?: string; is_group?: boolean };
type Line = { accountId: string; periodNumber: number; amount: string };

export default function BudgetEditor({ companyId, baseCurrency, accounts }: { companyId: string; baseCurrency: string; accounts: Account[] }) {
  const router = useRouter();
  const postingAccounts = accounts.filter((account) => !account.is_group);
  const [lines, setLines] = useState<Line[]>([{ accountId: postingAccounts[0]?.id || "", periodNumber: 1, amount: "0" }]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(formData: FormData) {
    setPending(true); setMessage("");
    try {
      const payload = {
        companyId,
        code: String(formData.get("code") || ""),
        name: String(formData.get("name") || ""),
        fiscalYear: String(formData.get("fiscalYear") || ""),
        scenario: String(formData.get("scenario") || "budget"),
        currencyCode: baseCurrency,
        controlMode: String(formData.get("controlMode") || "warning"),
        lines,
      };
      const response = await fetch("/api/accounting/budgets", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Budget creation failed.");
      setMessage("Budget draft created."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Budget creation failed."); }
    finally { setPending(false); }
  }

  return <form className="panel accounting-form" action={submit}><div><p className="eyebrow">Planning and control</p><h2>New budget version</h2><p>Create period/account budgets with warning or blocking controls.</p></div><div className="accounting-form-grid"><label>Code<input name="code" required /></label><label>Name<input name="name" required /></label><label>Fiscal year<input name="fiscalYear" required placeholder="2026-27" /></label><label>Scenario<select name="scenario"><option value="budget">Budget</option><option value="forecast">Forecast</option><option value="reforecast">Reforecast</option><option value="plan">Plan</option></select></label><label>Control mode<select name="controlMode"><option value="warning">Warning</option><option value="block">Block</option><option value="none">No enforcement</option></select></label></div><div className="accounting-table"><div className="accounting-table-row accounting-table-head"><span>Account</span><span>Period</span><span>Amount</span><span>Action</span></div>{lines.map((line, index) => <div className="accounting-table-row" key={`${index}-${line.accountId}`}><span><select value={line.accountId} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, accountId: event.target.value } : item))}>{postingAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></span><span><input min="1" max="14" type="number" value={line.periodNumber} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, periodNumber: Number(event.target.value) } : item))} /></span><span><input type="number" value={line.amount} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} /></span><span><button className="text-button" type="button" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></span></div>)}</div><div className="accounting-form-actions"><button className="secondary-button" type="button" onClick={() => setLines((current) => [...current, { accountId: postingAccounts[0]?.id || "", periodNumber: 1, amount: "0" }])}>Add line</button><button className="primary-button" disabled={pending || !lines.length} type="submit">{pending ? "Saving…" : "Create budget"}</button>{message ? <span>{message}</span> : null}</div></form>;
}
