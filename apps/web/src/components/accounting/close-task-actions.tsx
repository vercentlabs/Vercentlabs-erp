"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CloseTaskActions({
  endpoint,
  status,
  version,
}: {
  endpoint: string;
  status: string;
  version: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function update(nextStatus: string) {
    setPending(true);
    setMessage("");
    try {
      let note = `${nextStatus} from period-close workspace`;
      let evidence: Record<string, unknown> = {};
      if (["completed", "waived"].includes(nextStatus)) {
        const reference = window.prompt(
          nextStatus === "waived"
            ? "Enter the waiver evidence reference:"
            : "Enter the completion evidence reference:",
        )?.trim();
        if (!reference) throw new Error("An evidence reference is required.");
        if (nextStatus === "waived") {
          const reason = window.prompt("Enter the waiver reason:")?.trim();
          if (!reason) throw new Error("A waiver reason is required.");
          note = reason;
        }
        evidence = {
          type: "close-workspace-reference",
          reference,
        };
      }
      const response = await fetch(endpoint, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          note,
          evidence,
          expectedVersion: version,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message || "Close task update failed.");
      }
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Close task update failed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="accounting-action-wrap">
      {!["completed", "waived"].includes(status) ? (
        <>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() => update("completed")}
            type="button"
          >
            Complete
          </button>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() => update("waived")}
            type="button"
          >
            Waive
          </button>
        </>
      ) : (
        <button
          className="secondary-button"
          disabled={pending}
          onClick={() => update("pending")}
          type="button"
        >
          Reopen
        </button>
      )}
      {message ? <small className="form-error">{message}</small> : null}
    </span>
  );
}
