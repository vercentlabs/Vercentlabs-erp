"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/lib/client-request";

export default function SessionManager({
  sessions,
  currentSessionId,
}: {
  sessions: Array<{
    id: string;
    deviceName: string;
    ipAddress: string | null;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }>;
  currentSessionId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");

  async function action(
    actionName: "revoke" | "revoke-others",
    sessionId?: string,
  ) {
    if (pending) return;

    setPending(sessionId || actionName);
    setMessage("");
    const result = await requestJson("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: actionName, sessionId }),
    });
    setMessage(result.message || "Request completed.");
    setPending("");
    if (result.ok) router.refresh();
  }

  return (
    <div className="form-stack">
      <div className="card-title-row">
        <div>
          <p className="eyebrow">Active sessions</p>
          <h2>Devices signed into your account</h2>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => action("revoke-others")}
          disabled={Boolean(pending)}
        >
          Sign out other devices
        </button>
      </div>
      <div className="stack-list">
        {sessions.map((session) => (
          <div key={session.id}>
            <div>
              <strong>
                {session.deviceName}
                {session.id === currentSessionId ? " · Current" : ""}
              </strong>
              <span>{session.ipAddress || "IP unavailable"}</span>
              <small>
                Last active {new Date(session.lastSeenAt).toLocaleString()}
              </small>
            </div>
            {session.id !== currentSessionId ? (
              <button
                type="button"
                className="danger-link"
                onClick={() => action("revoke", session.id)}
                disabled={Boolean(pending)}
              >
                Revoke
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
