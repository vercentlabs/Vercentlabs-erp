"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import LeadWorkspaceDrawer from "@/modules/crm/components/lead-workspace-drawer";
import { requestJson } from "@/shared/http/client-request";

type AccountRecord = Record<string, unknown>;

function value(record: AccountRecord | undefined, key: string) {
  return String(record?.[key] ?? "");
}

export default function AccountFormDrawer({
  account,
  closeHref,
}: {
  account?: AccountRecord;
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const editing = Boolean(account?.id);

  function close() {
    if (dirty && !window.confirm("Discard the unsaved account changes?"))
      return;
    router.replace(closeHref);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setErrors({});
    const body = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    const endpoint = editing
      ? `/api/crm/accounts/${String(account?.id)}`
      : "/api/crm/accounts";
    const result = await requestJson<{
      record?: AccountRecord;
      errors?: Record<string, string[]>;
    }>(endpoint, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!result.ok) {
      setErrors(result.errors || {});
      setMessage(result.message || "The account could not be saved.");
      setPending(false);
      return;
    }
    const id = String(result.record?.id || account?.id || "");
    setDirty(false);
    router.replace(id ? `/crm/accounts/${id}` : "/crm/accounts");
    router.refresh();
  }

  const fieldError = (name: string) => errors[name]?.[0];

  return (
    <LeadWorkspaceDrawer
      title={editing ? "Edit account" : "Create account"}
      description={
        editing
          ? "Update the company identity and business contact details."
          : "Add a company or organisation to your CRM."
      }
      onClose={close}
      width="form"
      canDismiss={!pending}
    >
      <form
        className="crm-account-form"
        onSubmit={submit}
        onChange={() => setDirty(true)}
        noValidate
      >
        {message ? (
          <div className="notice error" role="alert">
            <strong>Account not saved</strong>
            <p>{message}</p>
          </div>
        ) : null}

        <fieldset className="crm-account-form-section">
          <legend>Company identity</legend>
          <p>Use the company name people recognise in everyday CRM work.</p>
          <div className="crm-account-form-grid">
            <label className="crm-account-field crm-account-field--wide">
              <span>Company name *</span>
              <input
                name="displayName"
                defaultValue={value(account, "displayName")}
                maxLength={180}
                required
                aria-invalid={Boolean(fieldError("displayName"))}
                aria-describedby={
                  fieldError("displayName")
                    ? "account-displayName-error"
                    : undefined
                }
              />
              {fieldError("displayName") ? (
                <small id="account-displayName-error" className="field-error">
                  {fieldError("displayName")}
                </small>
              ) : null}
            </label>
            <label className="crm-account-field">
              <span>Legal name</span>
              <input
                name="legalName"
                defaultValue={value(account, "legalName")}
                maxLength={180}
              />
            </label>
            <label className="crm-account-field">
              <span>Account type</span>
              <select
                name="partyType"
                defaultValue={value(account, "partyType") || "prospect"}
              >
                <option value="prospect">Prospect</option>
                <option value="customer">Customer</option>
                <option value="both">Customer and supplier</option>
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className="crm-account-form-section">
          <legend>Business information</legend>
          <div className="crm-account-form-grid">
            <label className="crm-account-field">
              <span>Industry</span>
              <input
                name="industry"
                defaultValue={value(account, "industry")}
                maxLength={160}
              />
            </label>
            <label className="crm-account-field">
              <span>Website</span>
              <input
                name="website"
                type="url"
                inputMode="url"
                placeholder="https://example.com"
                defaultValue={value(account, "website")}
                aria-invalid={Boolean(fieldError("website"))}
              />
              {fieldError("website") ? (
                <small className="field-error">{fieldError("website")}</small>
              ) : null}
            </label>
            <label className="crm-account-field">
              <span>Phone</span>
              <input
                name="phone"
                type="tel"
                defaultValue={value(account, "phone")}
                maxLength={30}
              />
            </label>
            <label className="crm-account-field">
              <span>General email</span>
              <input
                name="email"
                type="email"
                inputMode="email"
                defaultValue={value(account, "email")}
                aria-invalid={Boolean(fieldError("email"))}
              />
              {fieldError("email") ? (
                <small className="field-error">{fieldError("email")}</small>
              ) : null}
            </label>
            <label className="crm-account-field">
              <span>Currency</span>
              <input
                name="currencyCode"
                defaultValue={value(account, "currencyCode")}
                maxLength={3}
                placeholder="INR"
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="crm-account-form-section">
          <legend>Business location</legend>
          <p>
            Leave this section empty when the business address is not yet known.
          </p>
          <div className="crm-account-form-grid">
            <label className="crm-account-field crm-account-field--wide">
              <span>Address</span>
              <input
                name="addressLine1"
                defaultValue={value(account, "addressLine1")}
                maxLength={200}
              />
            </label>
            <label className="crm-account-field crm-account-field--wide">
              <span>Address line 2</span>
              <input
                name="addressLine2"
                defaultValue={value(account, "addressLine2")}
                maxLength={160}
              />
            </label>
            <label className="crm-account-field">
              <span>City</span>
              <input
                name="city"
                defaultValue={value(account, "city")}
                maxLength={120}
              />
            </label>
            <label className="crm-account-field">
              <span>State</span>
              <input
                name="state"
                defaultValue={value(account, "state")}
                maxLength={120}
              />
            </label>
            <label className="crm-account-field">
              <span>Postal code</span>
              <input
                name="postalCode"
                defaultValue={value(account, "postalCode")}
                maxLength={20}
              />
            </label>
            <label className="crm-account-field">
              <span>Country code</span>
              <input
                name="countryCode"
                defaultValue={value(account, "countryCode")}
                maxLength={2}
                placeholder="IN"
              />
            </label>
          </div>
        </fieldset>

        <footer className="crm-account-form-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={close}
          >
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create account"}
          </button>
        </footer>
      </form>
    </LeadWorkspaceDrawer>
  );
}
