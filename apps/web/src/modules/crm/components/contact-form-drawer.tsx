"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import ContactAccountLookup from "@/modules/crm/components/contact-account-lookup";
import LeadWorkspaceDrawer from "@/modules/crm/components/lead-workspace-drawer";
import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  ErrorState,
  FormField,
  FormSection,
} from "@/shared/design";

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
          <ErrorState title="Contact not saved" description={message} />
        ) : null}

        <FormSection
          title="Contact identity"
          description="Use the name and role colleagues will recognise."
        >
          <FormField
            label="First name"
            htmlFor="contact-firstName"
            required
            error={fieldError("firstName")}
          >
            <input
              id="contact-firstName"
              name="firstName"
              defaultValue={value(contact, "firstName")}
              autoFocus
              required
              maxLength={120}
              aria-invalid={Boolean(fieldError("firstName")) || undefined}
            />
          </FormField>
          <FormField label="Last name" htmlFor="contact-lastName">
            <input
              id="contact-lastName"
              name="lastName"
              defaultValue={value(contact, "lastName")}
              maxLength={120}
            />
          </FormField>
          <div className="crm-contact-field-wide">
            <FormField label="Job title" htmlFor="contact-designation">
              <input
                id="contact-designation"
                name="designation"
                defaultValue={value(contact, "designation")}
                maxLength={160}
              />
            </FormField>
          </div>
        </FormSection>

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

        <FormSection
          title="Reachability"
          description="Add at least one email or phone number for practical follow-up."
        >
          <div className="crm-contact-field-wide">
            <FormField
              label="Work email"
              htmlFor="contact-email"
              error={fieldError("email")}
            >
              <input
                id="contact-email"
                name="email"
                type="email"
                inputMode="email"
                defaultValue={value(contact, "email")}
                maxLength={254}
                aria-invalid={Boolean(fieldError("email")) || undefined}
              />
            </FormField>
          </div>
          <FormField
            label="Mobile"
            htmlFor="contact-mobile"
            error={fieldError("mobile")}
          >
            <input
              id="contact-mobile"
              name="mobile"
              type="tel"
              inputMode="tel"
              defaultValue={value(contact, "mobile")}
              maxLength={40}
              aria-invalid={Boolean(fieldError("mobile")) || undefined}
            />
          </FormField>
          <FormField
            label="Business phone"
            htmlFor="contact-phone"
            error={fieldError("phone")}
          >
            <input
              id="contact-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={value(contact, "phone")}
              maxLength={40}
              aria-invalid={Boolean(fieldError("phone")) || undefined}
            />
          </FormField>
        </FormSection>

        <footer className="crm-contact-form-actions">
          <ActionButton onClick={close} disabled={pending}>
            Cancel
          </ActionButton>
          <ActionButton tone="primary" type="submit" busy={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create contact"}
          </ActionButton>
        </footer>
      </form>
    </LeadWorkspaceDrawer>
  );
}
