"use client";

import { ActionButton } from "@/shared/design";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/shared/http/client-request";
import LeadAssigneeCombobox, { type LeadAssigneeOption } from "../lead-lifecycle-qualification-and-prioritization/lead-assignee-combobox";
import type { Row } from "./lead-detail-model";

export default function LeadOwnerDialog({
  lead,
  onClose,
}: {
  lead: Row;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const [selected, setSelected] = useState<LeadAssigneeOption | null>(
    lead.ownerUserId && lead.ownerStatus === "active"
      ? {
          id: String(lead.ownerUserId),
          name: String(lead.ownerName || "Current owner"),
          email: String(lead.ownerEmail || ""),
        }
      : null,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const close = () => onCloseRef.current();
    dialog.addEventListener("close", close);
    return () => dialog.removeEventListener("close", close);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await requestJson<Row>(
        `/api/crm/leads/${String(lead.id)}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerUserId: selected.id,
            expectedUpdatedAt: String(lead.updatedAt || ""),
          }),
        },
      );
      if (!result.ok)
        throw new Error(
          String(result.message || "Lead owner could not be changed."),
        );
      dialogRef.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Lead owner could not be changed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      className="crm-owner-dialog"
      ref={dialogRef}
      aria-labelledby="change-owner-title"
    >
      <form onSubmit={submit}>
        <header>
          <div>
            <p className="eyebrow">Lead ownership</p>
            <h2 id="change-owner-title">Change owner</h2>
          </div>
          <ActionButton
            aria-label="Close Change owner"
            tone="quiet"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </ActionButton>
        </header>
        <div className="crm-owner-dialog__body">
          <div className="crm-owner-dialog__current">
            <span>Current owner</span>
            <strong>{String(lead.ownerName || "Unassigned")}</strong>
            {lead.ownerStatus === "inactive" ? (
              <small>Inactive organization member</small>
            ) : null}
          </div>
          <label>
            <span>New owner</span>
            <LeadAssigneeCombobox value={selected} onChange={setSelected} />
            <small>
              Only active CRM members with access to this company and branch are
              shown.
            </small>
          </label>
          {message ? (
            <p className="field-error" role="alert">
              {message}
            </p>
          ) : null}
        </div>
        <footer>
          <ActionButton
            tone="secondary"
            busy={pending}
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            Cancel
          </ActionButton>
          <ActionButton
            tone="primary"
            disabled={!selected}
            busy={pending}
            type="submit"
          >
            {pending ? "Assigning…" : "Assign owner"}
          </ActionButton>
        </footer>
      </form>
    </dialog>
  );
}
