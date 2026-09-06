"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import LeadWorkspaceDrawer from "@/modules/crm/components/lead-workspace-drawer";
import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  ErrorState,
  FormField,
  FormSection,
} from "@/shared/design";

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
          <ErrorState title="Account not saved" description={message} />
        ) : null}

        <FormSection
          title="Company identity"
          description="Use the company name people recognise in everyday CRM work."
        >
          <div className="crm-account-field--wide">
            <FormField
              label="Company name"
              htmlFor="account-displayName"
              required
              error={fieldError("displayName")}
            >
              <input
                id="account-displayName"
                name="displayName"
                defaultValue={value(account, "displayName")}
                maxLength={180}
                required
                aria-invalid={Boolean(fieldError("displayName"))}
              />
            </FormField>
          </div>
          <FormField label="Legal name" htmlFor="account-legalName">
            <input
              id="account-legalName"
              name="legalName"
              defaultValue={value(account, "legalName")}
              maxLength={180}
            />
          </FormField>
          <FormField label="Account type" htmlFor="account-partyType">
            <select
              id="account-partyType"
              name="partyType"
              defaultValue={value(account, "partyType") || "prospect"}
            >
              <option value="prospect">Prospect</option>
              <option value="customer">Customer</option>
              <option value="both">Customer and supplier</option>
            </select>
          </FormField>
        </FormSection>

        <FormSection title="Business information">
          <FormField label="Industry" htmlFor="account-industry">
            <input
              id="account-industry"
              name="industry"
              defaultValue={value(account, "industry")}
              maxLength={160}
            />
          </FormField>
          <FormField
            label="Website"
            htmlFor="account-website"
            error={fieldError("website")}
          >
            <input
              id="account-website"
              name="website"
              type="url"
              inputMode="url"
              placeholder="https://example.com"
              defaultValue={value(account, "website")}
              aria-invalid={Boolean(fieldError("website"))}
            />
          </FormField>
          <FormField label="Phone" htmlFor="account-phone">
            <input
              id="account-phone"
              name="phone"
              type="tel"
              defaultValue={value(account, "phone")}
              maxLength={30}
            />
          </FormField>
          <FormField
            label="General email"
            htmlFor="account-email"
            error={fieldError("email")}
          >
            <input
              id="account-email"
              name="email"
              type="email"
              inputMode="email"
              defaultValue={value(account, "email")}
              aria-invalid={Boolean(fieldError("email"))}
            />
          </FormField>
          <FormField label="Currency" htmlFor="account-currencyCode">
            <input
              id="account-currencyCode"
              name="currencyCode"
              defaultValue={value(account, "currencyCode")}
              maxLength={3}
              placeholder="INR"
            />
          </FormField>
        </FormSection>

        <FormSection
          title="Business location"
          description="Leave this section empty when the business address is not yet known."
        >
          <div className="crm-account-field--wide">
            <FormField label="Address" htmlFor="account-addressLine1">
              <input
                id="account-addressLine1"
                name="addressLine1"
                defaultValue={value(account, "addressLine1")}
                maxLength={200}
              />
            </FormField>
          </div>
          <div className="crm-account-field--wide">
            <FormField label="Address line 2" htmlFor="account-addressLine2">
              <input
                id="account-addressLine2"
                name="addressLine2"
                defaultValue={value(account, "addressLine2")}
                maxLength={160}
              />
            </FormField>
          </div>
          <FormField label="City" htmlFor="account-city">
            <input
              id="account-city"
              name="city"
              defaultValue={value(account, "city")}
              maxLength={120}
            />
          </FormField>
          <FormField label="State" htmlFor="account-state">
            <input
              id="account-state"
              name="state"
              defaultValue={value(account, "state")}
              maxLength={120}
            />
          </FormField>
          <FormField label="Postal code" htmlFor="account-postalCode">
            <input
              id="account-postalCode"
              name="postalCode"
              defaultValue={value(account, "postalCode")}
              maxLength={20}
            />
          </FormField>
          <FormField label="Country code" htmlFor="account-countryCode">
            <input
              id="account-countryCode"
              name="countryCode"
              defaultValue={value(account, "countryCode")}
              maxLength={2}
              placeholder="IN"
            />
          </FormField>
        </FormSection>

        <footer className="crm-account-form-actions">
          <ActionButton onClick={close} disabled={pending}>
            Cancel
          </ActionButton>
          <ActionButton tone="primary" type="submit" busy={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create account"}
          </ActionButton>
        </footer>
      </form>
    </LeadWorkspaceDrawer>
  );
}
