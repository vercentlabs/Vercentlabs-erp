"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type OAuthRow = {
  id: string;
  provider: string;
  provider_account_label: string | null;
  scopes: string[];
  status: string;
  expires_at: string | null;
  updated_at: string;
};

function messageOf(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = String((payload as { message?: unknown }).message || "").trim();
    if (message) return message;
  }
  return fallback;
}

export function IntegrationDeveloperManager({
  keys,
  connections,
}: {
  keys: ApiKeyRow[];
  connections: OAuthRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  async function createKey(formData: FormData) {
    setBusy("create-key");
    setError(null);
    setRevealedToken(null);
    try {
      const name = String(formData.get("name") || "").trim();
      const scopes = String(formData.get("scopes") || "")
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const response = await fetch("/api/platform/integrations/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messageOf(payload, "API key creation failed."));
      const token = String((payload as { token?: unknown }).token || "");
      if (!token) throw new Error("The API key was created but its one-time token was not returned.");
      setRevealedToken(token);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "API key creation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeKey(id: string) {
    setBusy(`key:${id}`);
    setError(null);
    try {
      const response = await fetch(`/api/platform/integrations/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messageOf(payload, "API key revocation failed."));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "API key revocation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function connect(provider: "google" | "microsoft") {
    setBusy(`oauth:${provider}`);
    setError(null);
    try {
      const scopes = provider === "google"
        ? ["openid", "email", "https://www.googleapis.com/auth/gmail.send"]
        : ["openid", "email", "offline_access", "Mail.Send"];
      const response = await fetch("/api/platform/integrations/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, scopes }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messageOf(payload, `${provider} OAuth could not start.`));
      const authorizeUrl = String((payload as { authorizeUrl?: unknown }).authorizeUrl || "");
      if (!authorizeUrl) throw new Error("OAuth provider URL was not returned.");
      window.location.assign(authorizeUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OAuth connection failed.");
      setBusy(null);
    }
  }

  async function revokeOAuth(id: string) {
    setBusy(`oauth-id:${id}`);
    setError(null);
    try {
      const response = await fetch(`/api/platform/integrations/oauth/${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messageOf(payload, "OAuth revocation failed."));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OAuth revocation failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-list">
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      {revealedToken ? (
        <div className="alert warning" role="status">
          <strong>Copy this API key now. It will not be shown again.</strong>
          <pre className="audit-event-detail">{revealedToken}</pre>
        </div>
      ) : null}

      <div className="table-panel">
        <table>
          <thead><tr><th scope="col">API key</th><th scope="col">Scopes</th><th scope="col">Status</th><th scope="col">Last used</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td><strong>{key.name}</strong><br /><code>{key.prefix}…</code></td>
                <td>{key.scopes.join(", ") || "No scopes"}</td>
                <td>{key.status}</td>
                <td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}</td>
                <td><button type="button" disabled={busy === `key:${key.id}` || key.status !== "active"} onClick={() => void revokeKey(key.id)}>Revoke</button></td>
              </tr>
            ))}
            {!keys.length ? <tr><td colSpan={5}>No tenant API keys created.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <form action={createKey} className="form-grid">
        <label>Key name<input name="name" required maxLength={120} placeholder="Reporting integration" /></label>
        <label>Scopes<input name="scopes" defaultValue="platform.context.read" placeholder="platform.context.read" /></label>
        <button type="submit" disabled={busy === "create-key"}>{busy === "create-key" ? "Creating…" : "Create API key"}</button>
      </form>

      <div className="section-title-row">
        <div><strong>OAuth connections</strong><p>Provider credentials are encrypted at rest and OAuth state is one-time and short-lived.</p></div>
        <div className="action-row">
          <button type="button" disabled={Boolean(busy)} onClick={() => void connect("google")}>Connect Google</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => void connect("microsoft")}>Connect Microsoft</button>
        </div>
      </div>
      <div className="table-panel">
        <table>
          <thead><tr><th scope="col">Provider</th><th scope="col">Account</th><th scope="col">Scopes</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {connections.map((connection) => (
              <tr key={connection.id}>
                <td>{connection.provider}</td>
                <td>{connection.provider_account_label || "Connected account"}</td>
                <td>{connection.scopes.join(", ") || "—"}</td>
                <td>{connection.status}</td>
                <td><button type="button" disabled={Boolean(busy) || connection.status === "revoked"} onClick={() => void revokeOAuth(connection.id)}>Revoke</button></td>
              </tr>
            ))}
            {!connections.length ? <tr><td colSpan={5}>No OAuth connections configured.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
