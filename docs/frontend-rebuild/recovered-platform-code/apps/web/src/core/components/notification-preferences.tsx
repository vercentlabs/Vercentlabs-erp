"use client";

import { useState } from "react";

type Preference = {
  channel: string;
  category: string;
  enabled: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
};

const DEFAULT_CATEGORIES = ["workflow", "approval", "security", "billing"] as const;
const CHANNELS = ["in_app", "email", "push"] as const;

export function NotificationPreferences({ preferences }: { preferences: Preference[] }) {
  const initial = new Map(preferences.map((item) => [`${item.category}:${item.channel}`, item.enabled]));
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(category: string, channel: string, enabled: boolean) {
    const key = `${category}:${channel}`;
    const previous = values.get(key) ?? true;
    const next = new Map(values);
    next.set(key, enabled);
    setValues(next);
    setBusy(key);
    setError(null);
    try {
      const response = await fetch("/api/platform/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, channel, enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String((payload as { message?: unknown }).message || "Preference update failed."));
    } catch (cause) {
      const rolledBack = new Map(next);
      rolledBack.set(key, previous);
      setValues(rolledBack);
      setError(cause instanceof Error ? cause.message : "Preference update failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="dashboard-section" aria-labelledby="notification-preferences-title">
      <div className="section-title-row"><div><p className="eyebrow">Delivery controls</p><h2 id="notification-preferences-title">Notification preferences</h2></div></div>
      {error ? <div role="alert" className="alert error">{error}</div> : null}
      <div className="table-panel">
        <table>
          <thead><tr><th scope="col">Category</th>{CHANNELS.map((channel) => <th scope="col" key={channel}>{channel.replace("_", " ")}</th>)}</tr></thead>
          <tbody>
            {DEFAULT_CATEGORIES.map((category) => (
              <tr key={category}>
                <th scope="row">{category}</th>
                {CHANNELS.map((channel) => {
                  const key = `${category}:${channel}`;
                  const checked = values.get(key) ?? true;
                  return <td key={channel}><label><input type="checkbox" checked={checked} disabled={busy === key} onChange={(event) => void update(category, channel, event.currentTarget.checked)} /> Enabled</label></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
