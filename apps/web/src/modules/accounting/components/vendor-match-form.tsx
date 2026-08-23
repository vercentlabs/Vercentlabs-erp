"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  endpoint: string;
  currentStatus?: string;
  billTotal: string;
  canOverride: boolean;
};

export default function VendorMatchForm({ endpoint, currentStatus, billTotal, canOverride }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function send(payload: Record<string, unknown>) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Matching action failed.");
      setMessage("Matching control updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Matching action failed.");
    } finally {
      setPending(false);
    }
  }

  async function evaluate(formData: FormData) {
    await send({
      action: "evaluate",
      matchType: String(formData.get("matchType") || "manual"),
      purchaseOrderId: String(formData.get("purchaseOrderId") || "") || undefined,
      goodsReceiptId: String(formData.get("goodsReceiptId") || "") || undefined,
      orderedAmount: String(formData.get("orderedAmount") || billTotal),
      receivedAmount: String(formData.get("receivedAmount") || billTotal),
      quantityVariance: String(formData.get("quantityVariance") || "0"),
      toleranceAmount: String(formData.get("toleranceAmount") || "0"),
    });
  }

  async function override(formData: FormData) {
    await send({ action: "override", reason: String(formData.get("reason") || "") });
  }

  return <section className="panel">
    <div className="accounting-section-heading"><div><p className="eyebrow">Procure-to-pay control</p><h2>Two-way and three-way matching</h2></div><span className="status-badge neutral">{currentStatus || "not evaluated"}</span></div>
    <form className="accounting-form-grid" action={evaluate}>
      <label>Match type<select name="matchType" defaultValue="manual"><option value="manual">Manual review</option><option value="two_way">Two-way: PO and bill</option><option value="three_way">Three-way: PO, receipt and bill</option></select></label>
      <label>Purchase order ID<input name="purchaseOrderId" placeholder="Required for two-way/three-way" /></label>
      <label>Goods receipt ID<input name="goodsReceiptId" placeholder="Required for three-way" /></label>
      <label>Ordered amount<input name="orderedAmount" type="number" step="0.000001" defaultValue={billTotal} /></label>
      <label>Received amount<input name="receivedAmount" type="number" step="0.000001" defaultValue={billTotal} /></label>
      <label>Quantity variance<input name="quantityVariance" type="number" step="0.000001" defaultValue="0" /></label>
      <label>Tolerance<input name="toleranceAmount" type="number" step="0.000001" defaultValue="0" /></label>
      <div className="accounting-form-actions"><button className="secondary-button" disabled={pending} type="submit">{pending ? "Checking…" : "Evaluate match"}</button></div>
    </form>
    {currentStatus === "exception" && canOverride ? <form className="accounting-form-grid" action={override}><label>Override reason<input name="reason" required minLength={8} /></label><div className="accounting-form-actions"><button className="danger-button" disabled={pending} type="submit">Override exception</button></div></form> : null}
    {message ? <p>{message}</p> : null}
  </section>;
}
