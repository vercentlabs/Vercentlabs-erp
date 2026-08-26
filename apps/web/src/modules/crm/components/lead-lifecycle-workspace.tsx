"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import { requestJson } from "@/shared/http/client-request";

type Stage = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  sortOrder: number;
  status: "active" | "inactive";
  isSystem: boolean;
  isInitial: boolean;
  leadCount: number;
};

export default function LeadLifecycleWorkspace({ rows }: { rows: Stage[] }) {
  const router = useRouter();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Stage | null | undefined>(undefined);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const drawer = drawerRef.current;
    if (editing !== undefined && drawer && !drawer.open) drawer.showModal();
    if (editing === undefined && drawer?.open) drawer.close();
  }, [editing]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get("name") || ""),
      description: String(form.get("description") || ""),
      sortOrder: Number(form.get("sortOrder") || 0),
    };
    setPending("save");
    setMessage("");
    const result = await requestJson(
      editing ? `/api/crm/lead-stages/${editing.id}` : "/api/crm/lead-stages",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setPending("");
    if (!result.ok) {
      setMessage(result.message || "Stage could not be saved.");
      return;
    }
    setEditing(undefined);
    setMessage(result.message || "Stage saved.");
    router.refresh();
  }

  async function setActive(stage: Stage, active: boolean) {
    if (!active && !confirm(`Deactivate ${stage.name}? Existing Leads will keep this stage.`)) return;
    setPending(stage.id);
    setMessage("");
    const result = await requestJson(`/api/crm/lead-stages/${stage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: active ? "reactivate" : "deactivate" }),
    });
    setPending("");
    setMessage(result.message || (result.ok ? "Stage updated." : "Stage could not be updated."));
    if (result.ok) router.refresh();
  }

  return (
    <main className="crm-lifecycle-page">
      <header className="crm-lifecycle-heading">
        <div>
          <p className="eyebrow">CRM · Lead management</p>
          <h1>Lead lifecycle</h1>
          <p>Keep the working journey short, ordered and independent from qualification and conversion.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setEditing(null)}>
          <AppIcon name="modules" size={16} /> Add stage
        </button>
      </header>

      {message ? <p className="notice" role="status">{message}</p> : null}

      <section className="crm-lifecycle-list" aria-label="Lead lifecycle stages">
        <div className="crm-lifecycle-list__header" aria-hidden="true">
          <span>Order</span><span>Stage</span><span>Leads</span><span>State</span><span>Actions</span>
        </div>
        {rows.map((stage, index) => (
          <article className={stage.status === "inactive" ? "is-inactive" : ""} key={stage.id}>
            <span className="crm-lifecycle-order">{String(index + 1).padStart(2, "0")}</span>
            <div className="crm-lifecycle-stage-copy">
              <strong>{stage.name}</strong>
              <span>{stage.description || "No description"}</span>
              <small>{stage.code}{stage.isInitial ? " · Initial stage" : ""}{stage.isSystem ? " · System" : ""}</small>
            </div>
            <span className="crm-lifecycle-count">{stage.leadCount}</span>
            <span className={`status-badge ${stage.status === "active" ? "success" : "neutral"}`}>{stage.status}</span>
            <div className="crm-lifecycle-actions">
              <button className="secondary-button" type="button" onClick={() => setEditing(stage)}>Edit</button>
              {stage.status === "active" ? (
                <button className="link-button" disabled={stage.isInitial || pending === stage.id} type="button" onClick={() => void setActive(stage, false)}>Deactivate</button>
              ) : (
                <button className="link-button" disabled={pending === stage.id} type="button" onClick={() => void setActive(stage, true)}>Reactivate</button>
              )}
            </div>
          </article>
        ))}
      </section>

      <aside className="crm-lifecycle-note">
        <AppIcon name="audit" size={18} />
        <p><strong>Lifecycle is not qualification.</strong> Moving a Lead never qualifies, disqualifies, archives, converts, reassigns or rescales it. Inactive stages remain visible on historical Leads.</p>
      </aside>

      <dialog className="crm-lifecycle-drawer" ref={drawerRef} onClose={() => setEditing(undefined)}>
        <form method="dialog" className="crm-lifecycle-drawer__close"><button aria-label="Close stage form" type="submit">×</button></form>
        <form onSubmit={submit}>
          <header>
            <p className="eyebrow">Lead lifecycle</p>
            <h2>{editing ? "Edit stage" : "Add stage"}</h2>
            <p>The internal code is created once and stays stable when the label changes.</p>
          </header>
          <label><span>Stage name</span><input autoFocus maxLength={120} name="name" required defaultValue={editing?.name || ""} /></label>
          <label><span>Description</span><textarea maxLength={1000} name="description" rows={4} defaultValue={editing?.description || ""} /></label>
          <label><span>Order</span><input min={0} max={100000} name="sortOrder" required type="number" defaultValue={editing?.sortOrder ?? (rows.length + 1) * 10} /></label>
          <footer>
            <button className="secondary-button" type="button" onClick={() => setEditing(undefined)}>Cancel</button>
            <button className="primary-button" disabled={pending === "save"} type="submit">{pending === "save" ? "Saving…" : "Save stage"}</button>
          </footer>
        </form>
      </dialog>
    </main>
  );
}
