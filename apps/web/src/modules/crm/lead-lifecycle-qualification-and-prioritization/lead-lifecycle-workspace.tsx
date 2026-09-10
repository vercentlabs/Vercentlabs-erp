"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCrmCommandDialog } from "@/modules/crm/ui/crm-command-dialog-provider";

import AppIcon from "@/shared/components/app-icon";
import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  cx,
  Dialog,
  EnterpriseDataGrid,
  FormField,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";
import styles from "./lead-lifecycle-workspace.module.css";

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
  dwellWarningHours?: number | null;
  dwellBreachHours?: number | null;
};

type Transition = {
  fromStageId: string;
  toStageId: string;
  fromStageCode: string;
  toStageCode: string;
  fromStageName: string;
  toStageName: string;
  reasonRequired: boolean;
};

type Reason = {
  id: string;
  scopeType: "transition" | "destination" | "any";
  fromStageId: string | null;
  toStageId: string | null;
  code: string;
  label: string;
  status: "active" | "inactive";
};

type MigrationJob = {
  id: string;
  status: string;
  resultManifest?: { requested?: number; processed?: number; percent?: number; failed?: number; conflict?: number };
};

function extractAffectedCount(message: string) {
  const match = /^(\d+)\s+active Lead/.exec(message);
  return match ? Number(match[1]) : null;
}

export default function LeadLifecycleWorkspace({
  rows,
  transitions,
  reasons,
}: {
  rows: Stage[];
  transitions: Transition[];
  reasons: Reason[];
}) {
  const router = useRouter();
  const { confirm: confirmAction } = useCrmCommandDialog();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Stage | null | undefined>(undefined);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [graphStageId, setGraphStageId] = useState<string | null>(null);
  const [migration, setMigration] = useState<{ stage: Stage; affected: number | null } | null>(null);
  const [migrationTargetId, setMigrationTargetId] = useState("");
  const [migrationJob, setMigrationJob] = useState<MigrationJob | null>(null);
  const [reasonForm, setReasonForm] = useState(false);

  const activeStages = rows.filter((stage) => stage.status === "active");

  useEffect(() => {
    const drawer = drawerRef.current;
    if (editing !== undefined && drawer && !drawer.open) drawer.showModal();
    if (editing === undefined && drawer?.open) drawer.close();
  }, [editing]);

  useEffect(() => {
    if (!migrationJob || migrationJob.status === "completed" || migrationJob.status === "dead") return;
    const timer = setTimeout(async () => {
      const result = await requestJson<{ record?: MigrationJob }>(`/api/crm/lead-stages/migration-jobs/${migrationJob.id}`);
      if (result.ok && result.record) setMigrationJob(result.record);
    }, 2000);
    return () => clearTimeout(timer);
  }, [migrationJob]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const warningHours = String(form.get("dwellWarningHours") || "").trim();
    const breachHours = String(form.get("dwellBreachHours") || "").trim();
    const body = {
      name: String(form.get("name") || ""),
      description: String(form.get("description") || ""),
      sortOrder: Number(form.get("sortOrder") || 0),
      dwellWarningHours: warningHours ? Number(warningHours) : null,
      dwellBreachHours: breachHours ? Number(breachHours) : null,
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

  async function setActive(stage: Stage, active: boolean, migrateToStageId?: string) {
    if (!active && !migrateToStageId && !(await confirmAction({ title: `Deactivate ${stage.name}?`, description: "This stage will stop accepting new leads. Existing records may require migration.", confirmLabel: "Deactivate" }))) return;
    setPending(stage.id);
    setMessage("");
    const result = await requestJson<{ migrationJob?: MigrationJob; code?: string }>(`/api/crm/lead-stages/${stage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(active ? { action: "reactivate" } : { action: "deactivate", migrateToStageId }),
    });
    setPending("");
    if (!result.ok && result.code === "CRM_LEAD_STAGE_HAS_ACTIVE_LEADS") {
      setMigration({ stage, affected: extractAffectedCount(String(result.message || "")) });
      return;
    }
    setMessage(result.message || (result.ok ? "Stage updated." : "Stage could not be updated."));
    if (result.ok && result.migrationJob) {
      setMigration(null);
      setMigrationJob(result.migrationJob);
    } else if (result.ok) {
      setMigration(null);
      router.refresh();
    }
  }

  async function toggleTransition(fromStageId: string, toStageId: string, exists: boolean, reasonRequired: boolean) {
    setPending(`${fromStageId}:${toStageId}`);
    const result = exists
      ? await requestJson(`/api/crm/lead-stages/transitions?from=${fromStageId}&to=${toStageId}`, { method: "DELETE" })
      : await requestJson("/api/crm/lead-stages/transitions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromStageId, toStageId, reasonRequired }),
        });
    setPending("");
    if (!result.ok) {
      setMessage(result.message || "Transition could not be updated.");
      return;
    }
    router.refresh();
  }

  async function createReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scopeType = String(form.get("scopeType") || "any");
    setPending("reason");
    const result = await requestJson("/api/crm/lead-stages/transition-reasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeType,
        fromStageId: scopeType === "transition" ? String(form.get("fromStageId") || "") : null,
        toStageId: scopeType !== "any" ? String(form.get("toStageId") || "") : null,
        code: String(form.get("code") || ""),
        label: String(form.get("label") || ""),
      }),
    });
    setPending("");
    if (!result.ok) {
      setMessage(result.message || "Reason could not be saved.");
      return;
    }
    setReasonForm(false);
    setMessage("Reason saved.");
    router.refresh();
  }

  async function setReasonActive(reason: Reason, active: boolean) {
    setPending(`reason-${reason.id}`);
    const result = await requestJson(`/api/crm/lead-stages/transition-reasons/${reason.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    setPending("");
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
            id: "dwell",
            header: "Dwell SLA",
            cell: (stage) =>
              stage.dwellWarningHours || stage.dwellBreachHours ? (
                <small>
                  {stage.dwellWarningHours ? `Warn ${stage.dwellWarningHours}h` : ""}
                  {stage.dwellWarningHours && stage.dwellBreachHours ? " · " : ""}
                  {stage.dwellBreachHours ? `Breach ${stage.dwellBreachHours}h` : ""}
                </small>
              ) : (
                <small>Not configured</small>
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
            cell: (stage) => (
              <div className="crm-lifecycle-actions">
                {actions(stage)}
                {stage.status === "active" ? (
                  <ActionButton type="button" onClick={() => setGraphStageId(stage.id)}>
                    Transitions
                  </ActionButton>
                ) : null}
              </div>
            ),
          },
        ];
        return (
          <EnterpriseDataGrid
            caption="Lead lifecycle stages"
            rows={rows}
            rowKey={(stage) => stage.id}
            columns={columns}
            renderMobileCard={(stage, index) => (
              <article className={cx("crm-lifecycle-card", styles.card)}>
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
                <p className={cx("crm-lifecycle-card__leads", styles.leads)}>{stage.leadCount} Leads</p>
                <footer className="crm-lifecycle-actions">
                  {actions(stage)}
                  {stage.status === "active" ? (
                    <ActionButton type="button" onClick={() => setGraphStageId(stage.id)}>
                      Transitions
                    </ActionButton>
                  ) : null}
                </footer>
              </article>
            )}
          />
        );
      })()}

      <aside className="crm-lifecycle-note">
        <AppIcon name="audit" size={18} />
        <p><strong>Lifecycle is not qualification.</strong> Moving a Lead never qualifies, disqualifies, archives, converts, reassigns or rescales it. Inactive stages remain visible on historical Leads.</p>
      </aside>

      <section className="crm-suite-surface" aria-labelledby="lifecycle-graph-title">
        <div className="crm-suite-section-heading">
          <div>
            <p className="eyebrow">Directed transition graph</p>
            <h2 id="lifecycle-graph-title">Allowed moves</h2>
            <p>Each row shows a stage&apos;s configured outgoing moves. A move must be added explicitly — the graph is directional (A→B does not imply B→A).</p>
          </div>
        </div>
        <ul className={styles.graphList}>
          {activeStages.map((stage) => {
            const outgoing = transitions.filter((edge) => edge.fromStageId === stage.id);
            return (
              <li key={stage.id} className={styles.graphRow}>
                <div className={styles.graphRowHeading}>
                  <strong>{stage.name}</strong>
                  <ActionButton type="button" onClick={() => setGraphStageId(stage.id)}>
                    Edit
                  </ActionButton>
                </div>
                <div className={styles.graphChips}>
                  {outgoing.length ? (
                    outgoing.map((edge) => (
                      <span key={edge.toStageId} className={styles.graphChip}>
                        → {edge.toStageName}
                        {edge.reasonRequired ? " (reason required)" : ""}
                      </span>
                    ))
                  ) : (
                    <span className={styles.graphChip}>No moves configured</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="crm-suite-surface" aria-labelledby="lifecycle-reasons-title">
        <div className="crm-suite-section-heading">
          <div>
            <p className="eyebrow">Governed vocabulary</p>
            <h2 id="lifecycle-reasons-title">Transition reasons</h2>
            <p>Apply to one transition, every move into a destination stage, or every transition in the org. Retiring a reason never rewrites past history — it stays snapshotted on each event.</p>
          </div>
          <ActionButton type="button" onClick={() => setReasonForm((value) => !value)}>
            {reasonForm ? "Cancel" : "Add reason"}
          </ActionButton>
        </div>
        {reasonForm ? (
          <form className="crm-suite-form" onSubmit={createReason}>
            <FormField label="Scope" htmlFor="reason-scope">
              <select id="reason-scope" name="scopeType" defaultValue="any">
                <option value="any">Any transition</option>
                <option value="destination">Any move into a stage</option>
                <option value="transition">One specific transition</option>
              </select>
            </FormField>
            <FormField label="From stage (transition scope only)" htmlFor="reason-from">
              <select id="reason-from" name="fromStageId" defaultValue="">
                <option value="">—</option>
                {activeStages.map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="To stage (destination/transition scope)" htmlFor="reason-to">
              <select id="reason-to" name="toStageId" defaultValue="">
                <option value="">—</option>
                {activeStages.map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Code" htmlFor="reason-code" required>
              <input id="reason-code" name="code" required pattern="[a-z][a-z0-9_]*" maxLength={64} placeholder="lost_budget" />
            </FormField>
            <FormField label="Label" htmlFor="reason-label" required>
              <input id="reason-label" name="label" required maxLength={160} placeholder="Lost — budget unavailable" />
            </FormField>
            <footer>
              <ActionButton tone="primary" type="submit" busy={pending === "reason"}>
                {pending === "reason" ? "Saving…" : "Save reason"}
              </ActionButton>
            </footer>
          </form>
        ) : null}
        <ul className={styles.reasonList}>
          {reasons.map((reason) => (
            <li key={reason.id}>
              <div>
                <strong>{reason.label}</strong>
                <small>
                  {reason.scopeType === "any"
                    ? "Any transition"
                    : reason.scopeType === "destination"
                      ? `Into ${activeStages.find((stage) => stage.id === reason.toStageId)?.name || "stage"}`
                      : `${activeStages.find((stage) => stage.id === reason.fromStageId)?.name || "?"} → ${activeStages.find((stage) => stage.id === reason.toStageId)?.name || "?"}`}
                </small>
              </div>
              <ActionButton
                tone="quiet"
                type="button"
                disabled={pending === `reason-${reason.id}`}
                onClick={() => void setReasonActive(reason, reason.status !== "active")}
              >
                {reason.status === "active" ? "Deactivate" : "Reactivate"}
              </ActionButton>
            </li>
          ))}
          {!reasons.length ? <p>No governed reasons configured yet.</p> : null}
        </ul>
      </section>

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
          <label>
            <span>Dwell warning (hours)</span>
            <input min={1} max={100000} name="dwellWarningHours" type="number" defaultValue={editing?.dwellWarningHours ?? ""} placeholder="Optional" />
          </label>
          <label>
            <span>Dwell breach (hours)</span>
            <input min={1} max={100000} name="dwellBreachHours" type="number" defaultValue={editing?.dwellBreachHours ?? ""} placeholder="Optional" />
          </label>
          <footer>
            <ActionButton type="button" onClick={() => setEditing(undefined)}>Cancel</ActionButton>
            <ActionButton tone="primary" busy={pending === "save"} type="submit">{pending === "save" ? "Saving…" : "Save stage"}</ActionButton>
          </footer>
        </form>
      </dialog>

      {graphStageId ? (
        <Dialog
          title={`Moves out of ${activeStages.find((stage) => stage.id === graphStageId)?.name || "stage"}`}
          description="A move must be added explicitly — the graph is directional (A→B does not imply B→A)."
          onClose={() => setGraphStageId(null)}
        >
          <ul className={styles.graphChecklist}>
            {activeStages
              .filter((stage) => stage.id !== graphStageId)
              .map((target) => {
                const edge = transitions.find((row) => row.fromStageId === graphStageId && row.toStageId === target.id);
                const key = `${graphStageId}:${target.id}`;
                return (
                  <li key={target.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(edge)}
                        disabled={pending === key}
                        onChange={() => void toggleTransition(graphStageId, target.id, Boolean(edge), false)}
                      />
                      {target.name}
                    </label>
                    {edge ? (
                      <label className={styles.graphReasonToggle}>
                        <input
                          type="checkbox"
                          checked={edge.reasonRequired}
                          disabled={pending === key}
                          onChange={() => {
                            void requestJson("/api/crm/lead-stages/transitions", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ fromStageId: graphStageId, toStageId: target.id, reasonRequired: !edge.reasonRequired }),
                            }).then(() => router.refresh());
                          }}
                        />
                        Requires reason
                      </label>
                    ) : null}
                  </li>
                );
              })}
          </ul>
          <footer>
            <ActionButton type="button" onClick={() => setGraphStageId(null)}>
              Done
            </ActionButton>
          </footer>
        </Dialog>
      ) : null}

      {migration ? (
        <Dialog
          title={`Migrate Leads off ${migration.stage.name}`}
          description={`${migration.affected ?? "Some"} active Lead(s) are on this stage. Choose a replacement stage to move them through the governed transition command before ${migration.stage.name} can be deactivated.`}
          onClose={() => setMigration(null)}
          busy={pending === migration.stage.id}
        >
          <FormField label="Replacement stage" htmlFor="migration-target" required>
            <select
              id="migration-target"
              value={migrationTargetId}
              onChange={(event) => setMigrationTargetId(event.currentTarget.value)}
              required
            >
              <option value="">Select stage</option>
              {activeStages
                .filter((stage) => stage.id !== migration.stage.id)
                .map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.name}</option>
                ))}
            </select>
          </FormField>
          <footer>
            <ActionButton type="button" onClick={() => setMigration(null)}>
              Cancel
            </ActionButton>
            <ActionButton
              tone="primary"
              type="button"
              disabled={!migrationTargetId}
              busy={pending === migration.stage.id}
              onClick={() => void setActive(migration.stage, false, migrationTargetId)}
            >
              Migrate and deactivate
            </ActionButton>
          </footer>
        </Dialog>
      ) : null}

      {migrationJob ? (
        <Dialog
          title={`${migrationJob.resultManifest?.percent ?? 0}% complete`}
          description={`${migrationJob.resultManifest?.processed ?? 0} of ${migrationJob.resultManifest?.requested ?? 0} Lead(s) migrated.${migrationJob.resultManifest?.failed ? ` ${migrationJob.resultManifest.failed} failed.` : ""}${migrationJob.resultManifest?.conflict ? ` ${migrationJob.resultManifest.conflict} changed and were skipped — retry the deactivation to pick them up.` : ""}`}
          onClose={() => {
            setMigrationJob(null);
            router.refresh();
          }}
        >
          <footer>
            <ActionButton
              type="button"
              onClick={() => {
                setMigrationJob(null);
                router.refresh();
              }}
            >
              {migrationJob.status === "completed" ? "Done — refresh" : "Continue in background"}
            </ActionButton>
          </footer>
        </Dialog>
      ) : null}
    </main>
  );
}
