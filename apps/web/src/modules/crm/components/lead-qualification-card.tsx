"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, FormField, StatusBadge, type StatusTone } from "@/shared/design";

type Row = Record<string, unknown>;
type Criterion = { key: string; label: string; met: boolean; help?: string };
type Reason = { code: string; label: string };

function label(value: unknown) {
  return String(value || "Not reviewed")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function qualificationTone(state: unknown): StatusTone {
  const value = String(state || "not_reviewed");
  if (value === "qualified") return "success";
  if (value === "unqualified") return "danger";
  return "neutral";
}

function when(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function QualificationDialog({
  leadId,
  leadName,
  decision,
  reasons,
  needsOverride,
  onClose,
}: {
  leadId: string;
  leadName: string;
  decision: "qualified" | "unqualified";
  reasons: Reason[];
  needsOverride: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const pendingRef = useRef(false);
  const [reasonCode, setReasonCode] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const closed = () => closeRef.current();
    const cancel = (event: Event) => {
      if (pendingRef.current) event.preventDefault();
    };
    dialog.addEventListener("close", closed);
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("close", closed);
      dialog.removeEventListener("cancel", cancel);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await requestJson<Row>(
        `/api/crm/leads/${encodeURIComponent(leadId)}/qualification`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            reasonCode: decision === "unqualified" ? reasonCode : undefined,
            reasonText: form.get("reasonText"),
            note: form.get("note"),
            overrideUsed: needsOverride ? true : undefined,
            overrideReason: needsOverride ? overrideReason : undefined,
          }),
        },
      );
      if (!response.ok)
        throw new Error(String(response.message || "Decision could not be saved."));
      dialogRef.current?.close();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Decision could not be saved.");
    } finally {
      setPending(false);
    }
  }

  const unqualified = decision === "unqualified";
  return (
    <dialog
      className="crm-qualification-dialog"
      ref={dialogRef}
      aria-labelledby="qualification-dialog-title"
      aria-describedby="qualification-dialog-description"
    >
      <form onSubmit={submit}>
        <header>
          <div>
            <p className="eyebrow">Qualification decision</p>
            <h2 id="qualification-dialog-title">
              {unqualified ? "Mark as unqualified" : "Qualify lead"}
            </h2>
            <p id="qualification-dialog-description">
              {unqualified
                ? `Record why ${leadName} should not progress.`
                : `${leadName} meets the required readiness criteria.`}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close qualification decision"
            disabled={pending}
            onClick={() => dialogRef.current?.close()}
          >
            ×
          </button>
        </header>
        <div className="crm-qualification-dialog__body">
          {needsOverride ? (
            <FormField
              label="Override reason"
              htmlFor="qualification-override-reason"
              required
              hint="Required evidence is still missing. Explain why this Lead should be qualified anyway; the override is recorded on this decision's history."
            >
              <textarea
                id="qualification-override-reason"
                required
                minLength={3}
                rows={3}
                maxLength={1000}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.currentTarget.value)}
                autoFocus
              />
            </FormField>
          ) : null}
          {unqualified ? (
            <FormField label="Reason" htmlFor="qualification-reason" required>
              <select
                id="qualification-reason"
                required
                value={reasonCode}
                onChange={(event) => setReasonCode(event.currentTarget.value)}
                autoFocus
              >
                <option value="">Select a reason</option>
                {reasons.map((reason) => (
                  <option key={reason.code} value={reason.code}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          {unqualified && reasonCode === "other" ? (
            <FormField label="Other reason details" htmlFor="qualification-reason-text" required>
              <textarea id="qualification-reason-text" name="reasonText" required minLength={3} rows={3} />
            </FormField>
          ) : null}
          <FormField
            label={`${unqualified ? "Decision note" : "Qualification note"} (optional)`}
            htmlFor="qualification-note"
            hint="Keep this specific to the decision; general notes remain separate."
          >
            <textarea id="qualification-note" name="note" rows={3} maxLength={2000} autoFocus={!unqualified && !needsOverride} />
          </FormField>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </div>
        <footer>
          <ActionButton
            type="button"
            disabled={pending}
            onClick={() => dialogRef.current?.close()}
          >
            Cancel
          </ActionButton>
          <ActionButton
            tone="primary"
            type="submit"
            busy={pending}
            disabled={needsOverride && overrideReason.trim().length < 3}
          >
            {pending
              ? "Saving…"
              : needsOverride
                ? "Qualify anyway"
                : unqualified
                  ? "Mark unqualified"
                  : "Qualify lead"}
          </ActionButton>
        </footer>
      </form>
    </dialog>
  );
}

export default function LeadQualificationCard({
  lead,
  qualification,
  canManage,
}: {
  lead: Row;
  qualification: Row;
  canManage: boolean;
}) {
  const [decision, setDecision] = useState<"qualified" | "unqualified" | null>(null);
  const readiness = (qualification.readiness || {}) as Row;
  const required = (Array.isArray(readiness.required) ? readiness.required : []) as Criterion[];
  const recommended = (Array.isArray(readiness.recommended) ? readiness.recommended : []) as Criterion[];
  const history = (Array.isArray(qualification.history) ? qualification.history : []) as Row[];
  const reasons = (Array.isArray(qualification.reasons) ? qualification.reasons : []) as Reason[];
  const state = String(qualification.state || "not_reviewed");
  const mutable = canManage && String(lead.recordStatus || "active") === "active";
  const name = String(lead.fullName || lead.companyName || "this Lead");
  const canOverride = Boolean(qualification.canOverride);
  const ready = Boolean(readiness.ready);
  const needsOverride = decision === "qualified" && !ready;

  return (
    <section className="crm-suite-surface crm-lead-qualification-card" aria-labelledby="lead-qualification-heading">
      <div className="crm-lead-qualification-card__heading">
        <div>
          <p className="eyebrow">Qualification</p>
          <h2 id="lead-qualification-heading">Commercial readiness</h2>
        </div>
        <StatusBadge tone={qualificationTone(state)}>{label(state)}</StatusBadge>
      </div>
      <div className="crm-lead-qualification-card__summary">
        <strong>{readiness.ready ? "Ready for a decision" : "Required information is missing"}</strong>
        {qualification.decidedAt ? (
          <small>
            Decided by {String(qualification.decidedByName || "Unknown user")} · {when(qualification.decidedAt)}
          </small>
        ) : (
          <small>Readiness is derived from current Lead data; the decision remains manual.</small>
        )}
        {qualification.evaluatedAt ? (
          <small>Last evaluated {when(qualification.evaluatedAt)}</small>
        ) : null}
      </div>
      <div className="crm-lead-qualification-criteria">
        <div>
          <h3>Required</h3>
          {required.map((criterion) => (
            <div key={criterion.key} className={criterion.met ? "is-met" : "is-missing"}>
              <span aria-hidden="true">{criterion.met ? "✓" : "!"}</span>
              <p><strong>{criterion.label}</strong><small>{criterion.help}</small></p>
            </div>
          ))}
        </div>
        <div>
          <h3>Recommended</h3>
          {recommended.map((criterion) => (
            <div key={criterion.key} className={criterion.met ? "is-met" : "is-recommended"}>
              <span aria-hidden="true">{criterion.met ? "✓" : "○"}</span>
              <p><strong>{criterion.label}</strong></p>
            </div>
          ))}
        </div>
      </div>
      {state === "unqualified" && qualification.reasonCode ? (
        <div className="crm-lead-qualification-reason">
          <span>Current reason</span>
          <strong>{label(qualification.reasonCode)}</strong>
          {qualification.reasonText ? <p>{String(qualification.reasonText)}</p> : null}
        </div>
      ) : null}
      {mutable ? (
        <div className="crm-lead-qualification-actions">
          {state !== "qualified" ? (
            <ActionButton
              tone="primary"
              type="button"
              disabled={!ready && !canOverride}
              onClick={() => setDecision("qualified")}
            >
              {!ready && canOverride
                ? "Qualify with override"
                : state === "unqualified"
                  ? "Requalify lead"
                  : "Qualify lead"}
            </ActionButton>
          ) : null}
          {state !== "unqualified" ? (
            <ActionButton type="button" onClick={() => setDecision("unqualified")}>
              Mark unqualified
            </ActionButton>
          ) : null}
        </div>
      ) : null}
      <details className="crm-lead-qualification-history">
        <summary>Decision history ({history.length})</summary>
        {history.length ? (
          <ol>
            {history.map((event) => (
              <li key={String(event.id)}>
                <strong>
                  {label(event.previousState)} → {label(event.newState)}
                  {event.overrideUsed ? <StatusBadge tone="warning">Override</StatusBadge> : null}
                </strong>
                <span>{String(event.decidedByName || "Unknown user")} · {when(event.createdAt)}</span>
                {event.reasonCode ? <small>{label(event.reasonCode)}</small> : null}
                {event.reasonText ? <p>{String(event.reasonText)}</p> : null}
                {event.overrideReason ? <p>Override: {String(event.overrideReason)}</p> : null}
                {event.note ? <p>{String(event.note)}</p> : null}
              </li>
            ))}
          </ol>
        ) : <p>No qualification decisions recorded.</p>}
      </details>
      {decision ? (
        <QualificationDialog
          leadId={String(lead.id)}
          leadName={name}
          decision={decision}
          reasons={reasons}
          needsOverride={needsOverride}
          onClose={() => setDecision(null)}
        />
      ) : null}
    </section>
  );
}
