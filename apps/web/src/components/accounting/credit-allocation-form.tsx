"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Candidate = {
  id: string;
  documentNumber: string;
  dueDate: string;
  currencyCode: string;
  outstandingAmount: string;
};

export default function CreditAllocationForm({
  endpoint,
  kind,
  creditBalance,
  candidates,
}: {
  endpoint: string;
  kind: "receivable" | "payable";
  creditBalance: string;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState(candidates[0]?.id || "");
  const selected = useMemo(() => candidates.find((row) => row.id === targetId), [candidates, targetId]);
  const suggested = Math.min(Number(creditBalance || 0), Number(selected?.outstandingAmount || 0));
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function apply() {
    setError("");
    if (!targetId || Number(amount) <= 0) {
      setError("Select an open document and enter an allocation amount.");
      return;
    }
    setPending(true);
    try {
      const allocation = kind === "receivable"
        ? { invoiceId: targetId, amount }
        : { billId: targetId, amount };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply_credit", input: { allocations: [allocation] } }),
      });
      const payload = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Credit could not be applied.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Credit could not be applied.");
    } finally {
      setPending(false);
    }
  }

  if (!candidates.length) return <p>No open documents are available for this credit.</p>;

  return (
    <div className="accounting-inline-form">
      <label>
        Apply to
        <select
          value={targetId}
          onChange={(event) => {
            const nextId = event.target.value;
            const next = candidates.find((row) => row.id === nextId);
            setTargetId(nextId);
            setAmount(String(Math.min(Number(creditBalance || 0), Number(next?.outstandingAmount || 0))));
          }}
        >
          {candidates.map((row) => (
            <option key={row.id} value={row.id}>
              {row.documentNumber} · due {row.dueDate.slice(0, 10)} · {row.currencyCode} {row.outstandingAmount}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amount
        <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <button className="primary-button" type="button" disabled={pending} onClick={apply}>
        {pending ? "Applying…" : "Apply credit"}
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
