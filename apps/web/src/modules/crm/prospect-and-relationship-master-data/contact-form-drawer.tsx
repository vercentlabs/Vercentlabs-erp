"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import ContactAccountLookup from "@/modules/crm/prospect-and-relationship-master-data/contact-account-lookup";
import LeadWorkspaceDrawer from "@/modules/crm/prospect-and-relationship-master-data/lead-workspace-drawer";
import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  describedById,
  ErrorState,
  FormField,
  FormSection,
} from "@/shared/design";

type ContactRecord = Record<string, unknown>;
type DuplicateCandidate = { id: string; first_name?: string; last_name?: string; email?: string; classification?: string };

// Curated, deliberately bounded lists — the server validates the full
// canonical BCP-47/IANA space regardless (see record-validation.js), so a
// value outside this list is never accepted even if somehow submitted;
// this just keeps the picker usable rather than a 400-entry dropdown.
const PREFERRED_LANGUAGE_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["en", "English"],
  ["en-IN", "English (India)"],
  ["en-GB", "English (UK)"],
  ["en-US", "English (US)"],
  ["hi", "Hindi"],
  ["fr", "French"],
  ["de", "German"],
  ["es", "Spanish"],
  ["pt", "Portuguese"],
  ["ar", "Arabic"],
  ["zh", "Chinese"],
  ["ja", "Japanese"],
];

const TIMEZONE_OPTIONS: readonly string[] = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "UTC",
];

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
  const [staleWrite, setStaleWrite] = useState(false);
  const editing = Boolean(contact?.id);

  const [firstName, setFirstName] = useState(value(contact, "firstName"));
  const [lastName, setLastName] = useState(value(contact, "lastName"));
  const [email, setEmail] = useState(value(contact, "email"));
  const [mobile, setMobile] = useState(value(contact, "mobile"));
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState("");
  const hasExactDuplicate = duplicates.some((d) => d.classification === "exact");
  const duplicateSaveBlocked = !editing && hasExactDuplicate && duplicateOverrideReason.trim().length < 10;

  useEffect(() => {
    if (editing) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!email.trim() && !mobile.trim() && !firstName.trim()) {
        setDuplicates([]);
        return;
      }
      const query = new URLSearchParams();
      if (email.trim()) query.set("email", email.trim());
      if (mobile.trim()) query.set("mobile", mobile.trim());
      if (firstName.trim()) query.set("firstName", firstName.trim());
      if (lastName.trim()) query.set("lastName", lastName.trim());
      const result = await requestJson<{ duplicates?: DuplicateCandidate[] }>(
        `/api/crm/contacts/duplicates?${query.toString()}`,
        { signal: controller.signal },
      );
      if (result.ok) setDuplicates(Array.isArray(result.duplicates) ? result.duplicates : []);
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [editing, email, mobile, firstName, lastName]);

  function close() {
    if (dirty && !window.confirm("Discard the unsaved contact changes?")) return;
    if (onDismiss) onDismiss();
    else router.replace(closeHref);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (duplicateSaveBlocked) {
      setMessage("Enter at least 10 characters explaining why this exact duplicate must be created.");
      return;
    }
    setPending(true);
    setMessage("");
    setErrors({});
    setStaleWrite(false);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const body: Record<string, unknown> = { ...values };
    if (!editing && hasExactDuplicate) {
      body.duplicateOverrideReason = duplicateOverrideReason.trim();
    }
    if (editing) {
      for (const field of [
        "firstName",
        "lastName",
        "designation",
        "email",
        "mobile",
        "phone",
        "accountId",
        "preferredLanguage",
        "timezone",
      ]) {
        if (String(body[field] ?? "") === value(contact, field)) delete body[field];
      }
      if (!Object.keys(body).length) {
        setMessage("No contact details have changed.");
        setPending(false);
        return;
      }
      body.expectedUpdatedAt = value(contact, "updatedAt");
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
      setStaleWrite(result.status === 409);
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
          <ErrorState
            title="Contact not saved"
            description={message}
            action={
              staleWrite ? (
                <ActionButton
                  type="button"
                  tone="secondary"
                  onClick={() => router.refresh()}
                >
                  Reload latest version
                </ActionButton>
              ) : null
            }
          />
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
              value={firstName}
              onChange={(event) => setFirstName(event.currentTarget.value)}
              autoFocus
              required
              maxLength={120}
              aria-invalid={Boolean(fieldError("firstName")) || undefined}
              aria-describedby={
                fieldError("firstName")
                  ? describedById("contact-firstName", "error")
                  : undefined
              }
            />
          </FormField>
          <FormField label="Last name" htmlFor="contact-lastName">
            <input
              id="contact-lastName"
              name="lastName"
              value={lastName}
              onChange={(event) => setLastName(event.currentTarget.value)}
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
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                maxLength={254}
                aria-invalid={Boolean(fieldError("email")) || undefined}
                aria-describedby={
                  fieldError("email")
                    ? describedById("contact-email", "error")
                    : undefined
                }
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
              value={mobile}
              onChange={(event) => setMobile(event.currentTarget.value)}
              maxLength={40}
              aria-invalid={Boolean(fieldError("mobile")) || undefined}
              aria-describedby={
                fieldError("mobile")
                  ? describedById("contact-mobile", "error")
                  : undefined
              }
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
              aria-describedby={
                fieldError("phone")
                  ? describedById("contact-phone", "error")
                  : undefined
              }
            />
          </FormField>
        </FormSection>

        <FormSection
          title="Communication preferences"
          description="Used to schedule and localize future outreach correctly."
        >
          <FormField
            label="Preferred language"
            htmlFor="contact-preferredLanguage"
            error={fieldError("preferredLanguage")}
          >
            <select
              id="contact-preferredLanguage"
              name="preferredLanguage"
              defaultValue={value(contact, "preferredLanguage")}
              aria-invalid={Boolean(fieldError("preferredLanguage")) || undefined}
            >
              <option value="">Not set</option>
              {PREFERRED_LANGUAGE_OPTIONS.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Time zone"
            htmlFor="contact-timezone"
            error={fieldError("timezone")}
          >
            <select
              id="contact-timezone"
              name="timezone"
              defaultValue={value(contact, "timezone")}
              aria-invalid={Boolean(fieldError("timezone")) || undefined}
            >
              <option value="">Not set</option>
              {TIMEZONE_OPTIONS.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </FormField>
        </FormSection>

        {!editing && duplicates.length ? (
          <div className="crm-contact-duplicate-warning" role="status">
            <strong>{hasExactDuplicate ? "Likely duplicate found" : "Possible duplicate found"}</strong>
            <ul>
              {duplicates.slice(0, 4).map((duplicate) => (
                <li key={duplicate.id}>
                  {[duplicate.first_name, duplicate.last_name].filter(Boolean).join(" ") || duplicate.email || "Existing contact"}
                </li>
              ))}
            </ul>
            {hasExactDuplicate ? (
              <FormField
                label="Why is this not the same person?"
                htmlFor="contact-duplicateOverrideReason"
                required
                hint="Required for an authorized exact-duplicate override. This reason is stored in immutable audit evidence."
              >
                <textarea
                  id="contact-duplicateOverrideReason"
                  value={duplicateOverrideReason}
                  onChange={(event) => setDuplicateOverrideReason(event.currentTarget.value)}
                  rows={2}
                  minLength={10}
                />
              </FormField>
            ) : null}
          </div>
        ) : null}

        <footer className="crm-contact-form-actions">
          <ActionButton onClick={close} disabled={pending}>
            Cancel
          </ActionButton>
          <ActionButton tone="primary" type="submit" busy={pending} disabled={duplicateSaveBlocked}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create contact"}
          </ActionButton>
        </footer>
      </form>
    </LeadWorkspaceDrawer>
  );
}
