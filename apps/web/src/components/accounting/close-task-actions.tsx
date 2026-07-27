"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CloseTaskActions({ endpoint, status }: { endpoint: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function update(nextStatus: string) {
    setPending(true); setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, note: `${nextStatus} from period-close workspace` }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(payload.message || "Close task update failed.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Close task update failed."); }
    finally { setPending(false); }
  }
  return <span className="accounting-action-wrap">
    {!['completed','waived'].includes(status) ? <><button className="secondary-button" disabled={pending} onClick={() => update("completed")} type="button">Complete</button><button className="secondary-button" disabled={pending} onClick={() => update("waived")} type="button">Waive</button></> : <button className="secondary-button" disabled={pending} onClick={() => update("pending")} type="button">Reopen</button>}
    {message ? <small className="form-error">{message}</small> : null}
  </span>;
}
