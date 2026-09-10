"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import LeadWorkspaceDrawer from "@/modules/crm/prospect-and-relationship-master-data/lead-workspace-drawer";
import { requestJson } from "@/shared/http/client-request";
import { ActionButton, describedById, ErrorState, FormField } from "@/shared/design";

type Source = Record<string, unknown>;
const value = (source: Source | null | undefined, key: string) =>
  String(source?.[key] ?? "");

export default function LeadSourceFormDrawer({
  source,
  closeHref,
}: {
  source?: Source | null;
  closeHref: string;
}) {
  const router = useRouter();
  const editing = Boolean(source?.id);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [staleWrite, setStaleWrite] = useState(false);
  function close() {
    if (dirty && !window.confirm("Discard unsaved Lead source changes?"))
      return;
    router.replace(closeHref);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setErrors({});
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      name: form.get("name"),
      description: form.get("description"),
      channel: form.get("channel"),
      sortOrder: Number(form.get("sortOrder") || 100),
      isDefault: form.get("isDefault") === "on",
    };
    if (editing) body.expectedUpdatedAt = value(source, "updatedAt");
    const endpoint = editing
      ? `/api/crm/lead-sources/${String(source?.id)}`
      : "/api/crm/lead-sources";
    const result = await requestJson<{
      record?: Source;
      errors?: Record<string, string[]>;
    }>(endpoint, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!result.ok) {
      setErrors(result.errors || {});
      setMessage(result.message || "The Lead source could not be saved.");
      setStaleWrite(result.status === 409);
      setPending(false);
      return;
    }
    setDirty(false);
    router.replace(closeHref);
    router.refresh();
  }
  const error = (field: string) => errors[field]?.[0];
  return (
    <LeadWorkspaceDrawer
      title={editing ? "Edit Lead source" : "Create Lead source"}
      description="Keep the catalogue concise and recognisable to sellers. The internal code is generated and remains stable."
      onClose={close}
      canDismiss={!pending}
      width="form"
    >
      <form
        className="crm-source-form"
        onSubmit={submit}
        onChange={() => setDirty(true)}
        noValidate
      >
        {message ? (
          <ErrorState
            title="Lead source not saved"
            description={message}
            action={
              staleWrite ? (
                <ActionButton type="button" tone="secondary" onClick={() => router.refresh()}>
                  Reload latest version
                </ActionButton>
              ) : null
            }
          />
        ) : null}
        <FormField
          label="Source name"
          htmlFor="source-name"
          required
          error={error("name")}
        >
          <input
            id="source-name"
            name="name"
            autoFocus
            required
            maxLength={120}
            defaultValue={value(source, "name")}
            aria-invalid={Boolean(error("name")) || undefined}
            aria-describedby={
              error("name") ? describedById("source-name", "error") : undefined
            }
          />
        </FormField>
        <FormField
          label="Description"
          htmlFor="source-description"
          error={error("description")}
          hint="Explain when colleagues should choose this source."
        >
          <textarea
            id="source-description"
            name="description"
            rows={4}
            maxLength={500}
            defaultValue={value(source, "description")}
            aria-describedby={describedById(
              "source-description",
              error("description") ? "error" : "hint",
            )}
          />
        </FormField>
        <div className="crm-source-form-grid">
          <FormField label="Channel" htmlFor="source-channel">
            <select
              id="source-channel"
              name="channel"
              defaultValue={value(source, "channel") || "other"}
            >
              <option value="website">Website</option>
              <option value="referral">Referral</option>
              <option value="partner">Partner</option>
              <option value="event">Event</option>
              <option value="advertising">Advertising</option>
              <option value="social">Social</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="walk_in">Walk-in</option>
              <option value="import">Import</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <FormField label="Display order" htmlFor="source-sortOrder">
            <input
              id="source-sortOrder"
              name="sortOrder"
              type="number"
              min={0}
              max={10000}
              step={1}
              defaultValue={value(source, "sortOrder") || "100"}
            />
          </FormField>
        </div>
        <label className="crm-source-default">
          <input
            name="isDefault"
            type="checkbox"
            defaultChecked={Boolean(source?.isDefault)}
          />
          <span>
            <strong>Default source</strong>
            <small>Place this source first in Lead selectors.</small>
          </span>
        </label>
        {editing ? (
          <p className="crm-source-code">
            Internal code <code>{value(source, "code")}</code> is stable and
            cannot be edited.
          </p>
        ) : null}
        <footer>
          <ActionButton onClick={close} disabled={pending}>
            Cancel
          </ActionButton>
          <ActionButton tone="primary" type="submit" busy={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create source"}
          </ActionButton>
        </footer>
      </form>
    </LeadWorkspaceDrawer>
  );
}
