"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  EnterpriseDataGrid,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";

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
        <ActionButton tone="primary" type="button" onClick={() => setEditing(null)}>
          <AppIcon name="modules" size={16} /> Add stage
        </ActionButton>
      </header>

      {message ? <p className="notice" role="status">{message}</p> : null}

      {(() => {
        const actions = (stage: Stage) => (
          <>
            <ActionButton type="button" onClick={() => setEditing(stage)}>
              Edit
            </ActionButton>
            {stage.status === "active" ? (
              <ActionButton
                tone="quiet"
                disabled={stage.isInitial || pending === stage.id}
                type="button"
                onClick={() => void setActive(stage, false)}
              >
                Deactivate
              </ActionButton>
            ) : (
              <ActionButton
                tone="quiet"
                disabled={pending === stage.id}
                type="button"
                onClick={() => void setActive(stage, true)}
              >
                Reactivate
              </ActionButton>
            )}
          </>
        );
        const columns: DataGridColumn<Stage>[] = [
          {
            id: "order",
            header: "Order",
            width: "70px",
            cell: (stage, index) => (
              <span className="crm-lifecycle-order">
                {String(index + 1).padStart(2, "0")}
              </span>
            ),
          },
          {
            id: "stage",
            header: "Stage",
            cell: (stage) => (
              <div className="crm-lifecycle-stage-copy">
                <strong>{stage.name}</strong>
                <span>{stage.description || "No description"}</span>
                <small>
                  {stage.code}
                  {stage.isInitial ? " · Initial stage" : ""}
                  {stage.isSystem ? " · System" : ""}
                </small>
              </div>
            ),
          },
          {
            id: "leads",
            header: "Leads",
            cell: (stage) => stage.leadCount,
          },
          {
            id: "state",
            header: "State",
            cell: (stage) => (
              <StatusBadge tone={stage.status === "active" ? "success" : "neutral"}>
                {stage.status}
              </StatusBadge>
            ),
          },
          {
            id: "actions",
            header: "Actions",
            cell: (stage) => <div className="crm-lifecycle-actions">{actions(stage)}</div>,
          },
        ];
        return (
          <EnterpriseDataGrid
            caption="Lead lifecycle stages"
            rows={rows}
            rowKey={(stage) => stage.id}
            columns={columns}
            renderMobileCard={(stage, index) => (
              <article className="crm-lifecycle-card">
                <header>
                  <span className="crm-lifecycle-order">{String(index + 1).padStart(2, "0")}</span>
                  <StatusBadge tone={stage.status === "active" ? "success" : "neutral"}>
                    {stage.status}
                  </StatusBadge>
                </header>
                <div className="crm-lifecycle-stage-copy">
                  <strong>{stage.name}</strong>
                  <span>{stage.description || "No description"}</span>
                  <small>
                    {stage.code}
                    {stage.isInitial ? " · Initial stage" : ""}
                    {stage.isSystem ? " · System" : ""}
                  </small>
                </div>
                <p className="crm-lifecycle-card__leads">{stage.leadCount} Leads</p>
                <footer className="crm-lifecycle-actions">{actions(stage)}</footer>
              </article>
            )}
          />
        );
      })()}

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
            <ActionButton type="button" onClick={() => setEditing(undefined)}>Cancel</ActionButton>
            <ActionButton tone="primary" busy={pending === "save"} type="submit">{pending === "save" ? "Saving…" : "Save stage"}</ActionButton>
          </footer>
        </form>
      </dialog>
    </main>
  );
}
