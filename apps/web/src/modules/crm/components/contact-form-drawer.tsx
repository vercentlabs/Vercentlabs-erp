"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import ContactAccountLookup from "@/modules/crm/components/contact-account-lookup";
import LeadWorkspaceDrawer from "@/modules/crm/components/lead-workspace-drawer";
import { requestJson } from "@/shared/http/client-request";

type ContactRecord = Record<string, unknown>;

function value(record: ContactRecord | undefined, key: string) {
  return String(record?.[key] ?? "");
}

export default function ContactFormDrawer({
  contact,
  closeHref,
  onDismiss,
}: {
  contact?: ContactRecord;
  closeHref: string;
  onDismiss?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const editing = Boolean(contact?.id);

  function close() {
    if (dirty && !window.confirm("Discard the unsaved contact changes?")) return;
    if (onDismiss) onDismiss();
    else router.replace(closeHref);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setErrors({});
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const body: Record<string, unknown> = { ...values };
    if (editing) {
      for (const field of [
        "firstName",
        "lastName",
        "designation",
        "email",
        "mobile",
        "phone",
        "accountId",
      ]) {
        if (String(body[field] ?? "") === value(contact, field)) delete body[field];
      }
      if (!Object.keys(body).length) {
        setMessage("No contact details have changed.");
        setPending(false);
        return;
      }
    }
    const endpoint = editing
      ? `/api/crm/contacts/${String(contact?.id)}`
      : "/api/crm/contacts";
    const result = await requestJson<{
      record?: ContactRecord;
      errors?: Record<string, string[]>;
    }>(endpoint, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!result.ok) {
      setErrors(result.errors || {});
      setMessage(result.message || "The contact could not be saved.");
      setPending(false);
      return;
    }
    const id = String(result.record?.id || contact?.id || "");
    setDirty(false);
    if (onDismiss) onDismiss();
    else router.replace(id ? `/crm/contacts/${id}` : "/crm/contacts");
    router.refresh();
  }

  const fieldError = (name: string) => errors[name]?.[0];

  return (
    <LeadWorkspaceDrawer
      title={editing ? "Edit contact" : "Create contact"}
      description={
        editing
          ? "Update the person’s identity, company and contact channels."
          : "Add a person with at least one reliable contact channel."
      }
      onClose={close}
      width="form"
      canDismiss={!pending}
    >
      <form
        className="crm-contact-form"
        onSubmit={submit}
        onChange={() => setDirty(true)}
        noValidate
      >
        {message ? (
          <div className="notice error" role="alert">
            <strong>Contact not saved</strong>
            <p>{message}</p>
          </div>
        ) : null}

        <fieldset className="crm-contact-form-section">
          <legend>Contact identity</legend>
          <p>Use the name and role colleagues will recognise.</p>
          <div className="crm-contact-form-grid">
            <label>
              <span>First name *</span>
              <input
                name="firstName"
                defaultValue={value(contact, "firstName")}
                autoFocus
                required
                maxLength={120}
                aria-invalid={Boolean(fieldError("firstName")) || undefined}
                aria-describedby={fieldError("firstName") ? "contact-first-error" : undefined}
              />
              {fieldError("firstName") ? (
                <small id="contact-first-error" className="field-error">
                  {fieldError("firstName")}
                </small>
              ) : null}
            </label>
            <label>
              <span>Last name</span>
              <input name="lastName" defaultValue={value(contact, "lastName")} maxLength={120} />
            </label>
            <label className="crm-contact-field-wide">
              <span>Job title</span>
              <input name="designation" defaultValue={value(contact, "designation")} maxLength={160} />
            </label>
          </div>
        </fieldset>

        <fieldset className="crm-contact-form-section">
          <legend>Company relationship</legend>
          <p>Link an active Account, or leave this person standalone.</p>
          <ContactAccountLookup
            initialId={value(contact, "accountId")}
            initialName={value(contact, "accountName")}
            initialStatus={value(contact, "accountStatus") || "active"}
            describedBy={fieldError("accountId") ? "contact-account-error" : undefined}
            invalid={Boolean(fieldError("accountId"))}
            onSelectionChange={() => setDirty(true)}
          />
          {fieldError("accountId") ? (
            <small id="contact-account-error" className="field-error">
              {fieldError("accountId")}
            </small>
          ) : null}
        </fieldset>

        <fieldset className="crm-contact-form-section">
          <legend>Reachability</legend>
          <p>Add at least one email or phone number for practical follow-up.</p>
          <div className="crm-contact-form-grid">
            <label className="crm-contact-field-wide">
              <span>Work email</span>
              <input
                name="email"
                type="email"
                inputMode="email"
                defaultValue={value(contact, "email")}
                maxLength={254}
                aria-invalid={Boolean(fieldError("email")) || undefined}
                aria-describedby={fieldError("email") ? "contact-email-error" : undefined}
              />
              {fieldError("email") ? (
                <small id="contact-email-error" className="field-error">
                  {fieldError("email")}
                </small>
              ) : null}
            </label>
            <label>
              <span>Mobile</span>
              <input
                name="mobile"
                type="tel"
                inputMode="tel"
                defaultValue={value(contact, "mobile")}
                maxLength={40}
                aria-invalid={Boolean(fieldError("mobile")) || undefined}
              />
              {fieldError("mobile") ? <small className="field-error">{fieldError("mobile")}</small> : null}
            </label>
            <label>
              <span>Business phone</span>
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                defaultValue={value(contact, "phone")}
                maxLength={40}
                aria-invalid={Boolean(fieldError("phone")) || undefined}
              />
              {fieldError("phone") ? <small className="field-error">{fieldError("phone")}</small> : null}
            </label>
          </div>
        </fieldset>

        <footer className="crm-contact-form-actions">
          <button className="secondary-button" type="button" onClick={close} disabled={pending}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create contact"}
          </button>
        </footer>
      </form>
    </LeadWorkspaceDrawer>
  );
}
