"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AccountingActionButton({ endpoint, action, label, body = {}, tone = "secondary" }: { endpoint: string; action: string; label: string; body?: Record<string, unknown>; tone?: "primary" | "secondary" | "danger" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setPending(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
      const payload = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "The action failed.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The action failed."); }
    finally { setPending(false); }
  }
  return <span className="accounting-action-wrap"><button className={tone === "primary" ? "primary-button" : tone === "danger" ? "danger-button" : "secondary-button"} disabled={pending} onClick={run} type="button">{pending ? "Working…" : label}</button>{error ? <small className="form-error">{error}</small> : null}</span>;
}
