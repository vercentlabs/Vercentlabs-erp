"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionButton, Dialog } from "@/shared/design";
import { requestJson } from "@/shared/http/client-request";
import LeadAssigneeCombobox, {
  type LeadAssigneeOption,
} from "../lead-lifecycle-qualification-and-prioritization/lead-assignee-combobox";
import type { Row } from "./lead-detail-model";

export default function LeadOwnerDialog({
  lead,
  onClose,
}: {
  lead: Row;
  onClose: () => void;
}) {
  const router = useRouter();
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
      if (!result.ok) {
        throw new Error(String(result.message || "Lead owner could not be changed."));
      }
      onClose();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Lead owner could not be changed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Change owner"
      description="Assign this lead to an active CRM member with access to the current company and branch."
      onClose={onClose}
      canDismiss={!pending}
      busy={pending}
      className="crm-owner-dialog"
    >
      <form onSubmit={submit}>
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
              Only active CRM members with access to this company and branch are shown.
            </small>
          </label>
          {message ? (
            <p className="field-error" role="alert">
              {message}
            </p>
          ) : null}
        </div>
        <footer>
          <ActionButton tone="secondary" disabled={pending} onClick={onClose} type="button">
            Cancel
          </ActionButton>
          <ActionButton tone="primary" disabled={!selected} busy={pending} type="submit">
            {pending ? "Assigning…" : "Assign owner"}
          </ActionButton>
        </footer>
      </form>
    </Dialog>
  );
}
