"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import LeadWorkspaceDrawer from "@/modules/crm/prospect-and-relationship-master-data/lead-workspace-drawer";
import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  describedById,
  ErrorState,
  FormField,
  FormSection,
} from "@/shared/design";

type AccountRecord = Record<string, unknown>;
type DuplicateCandidate = { id: string; display_name?: string; classification?: string };

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
  const [staleWrite, setStaleWrite] = useState(false);
  const editing = Boolean(account?.id);

  const [displayName, setDisplayName] = useState(value(account, "displayName"));
  const [legalName, setLegalName] = useState(value(account, "legalName"));
  const [gstin, setGstin] = useState(value(account, "gstin"));
  const [pan, setPan] = useState(value(account, "pan"));
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState("");
  const hasExactDuplicate = duplicates.some((d) => d.classification === "exact");
  const duplicateSaveBlocked = !editing && hasExactDuplicate && duplicateOverrideReason.trim().length < 10;

  useEffect(() => {
    if (editing) return;
    const name = legalName.trim() || displayName.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!name && !gstin.trim() && !pan.trim()) {
        setDuplicates([]);
        return;
      }
      const query = new URLSearchParams();
      if (name) query.set("name", name);
      if (gstin.trim()) query.set("gstin", gstin.trim());
      if (pan.trim()) query.set("pan", pan.trim());
      const result = await requestJson<{ duplicates?: DuplicateCandidate[] }>(
        `/api/crm/accounts/duplicates?${query.toString()}`,
        { signal: controller.signal },
      );
      if (result.ok) setDuplicates(Array.isArray(result.duplicates) ? result.duplicates : []);
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [editing, displayName, legalName, gstin, pan]);

  function close() {
    if (dirty && !window.confirm("Discard the unsaved account changes?"))
      return;
    router.replace(closeHref);
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
    const values = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    const body: Record<string, unknown> = { ...values };
    if (!editing && hasExactDuplicate) {
      body.duplicateOverrideReason = duplicateOverrideReason.trim();
    }
    if (editing) {
      // Only send fields that actually changed. Sensitive fields
      // (gstin/pan/msmeNumber) are always present as keys in the raw form
      // submission even when untouched — sending them unconditionally would
      // trip the server's presence-based sensitive-mutation gate
      // (account-operations.js's assertSensitiveAccountMutationAllowed) for
      // every account edit by a non-privileged user, not just ones that
      // actually change a statutory identifier.
      for (const field of [
        "displayName",
        "legalName",
        "partyType",
        "industry",
        "website",
        "phone",
        "email",
        "currencyCode",
        "addressLine1",
        "addressLine2",
        "city",
        "state",
        "postalCode",
        "countryCode",
        "gstin",
        "pan",
        "msmeNumber",
      ]) {
        if (String(body[field] ?? "") === value(account, field)) delete body[field];
      }
      if (!Object.keys(body).length) {
        setMessage("No account details have changed.");
        setPending(false);
        return;
      }
      body.expectedUpdatedAt = value(account, "updatedAt");
    }
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
      setStaleWrite(result.status === 409);
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
          <ErrorState
            title="Account not saved"
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
                value={displayName}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                maxLength={180}
                required
                aria-invalid={Boolean(fieldError("displayName"))}
                aria-describedby={
                  fieldError("displayName")
                    ? describedById("account-displayName", "error")
                    : undefined
                }
              />
            </FormField>
          </div>
          <FormField label="Legal name" htmlFor="account-legalName">
            <input
              id="account-legalName"
              name="legalName"
              value={legalName}
              onChange={(event) => setLegalName(event.currentTarget.value)}
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
              aria-describedby={
                fieldError("website")
                  ? describedById("account-website", "error")
                  : undefined
              }
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
              aria-describedby={
                fieldError("email")
                  ? describedById("account-email", "error")
                  : undefined
              }
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

        <FormSection
          title="Statutory identifiers"
          description="Visible and editable only to roles authorized for sensitive account content."
        >
          <FormField
            label="GSTIN"
            htmlFor="account-gstin"
            error={fieldError("gstin")}
          >
            <input
              id="account-gstin"
              name="gstin"
              value={gstin}
              onChange={(event) => setGstin(event.currentTarget.value)}
              maxLength={20}
              aria-invalid={Boolean(fieldError("gstin"))}
              aria-describedby={
                fieldError("gstin")
                  ? describedById("account-gstin", "error")
                  : undefined
              }
            />
          </FormField>
          <FormField
            label="PAN"
            htmlFor="account-pan"
            error={fieldError("pan")}
          >
            <input
              id="account-pan"
              name="pan"
              value={pan}
              onChange={(event) => setPan(event.currentTarget.value)}
              maxLength={10}
              aria-invalid={Boolean(fieldError("pan"))}
              aria-describedby={
                fieldError("pan")
                  ? describedById("account-pan", "error")
                  : undefined
              }
            />
          </FormField>
          <FormField
            label="MSME registration"
            htmlFor="account-msmeNumber"
            error={fieldError("msmeNumber")}
          >
            <input
              id="account-msmeNumber"
              name="msmeNumber"
              defaultValue={value(account, "msmeNumber")}
              maxLength={30}
              aria-invalid={Boolean(fieldError("msmeNumber"))}
              aria-describedby={
                fieldError("msmeNumber")
                  ? describedById("account-msmeNumber", "error")
                  : undefined
              }
            />
          </FormField>
        </FormSection>

        {!editing && duplicates.length ? (
          <div className="crm-account-duplicate-warning" role="status">
            <strong>{hasExactDuplicate ? "Likely duplicate found" : "Possible duplicate found"}</strong>
            <ul>
              {duplicates.slice(0, 4).map((duplicate) => (
                <li key={duplicate.id}>{duplicate.display_name || "Existing account"}</li>
              ))}
            </ul>
            {hasExactDuplicate ? (
              <FormField
                label="Why is this not the same account?"
                htmlFor="account-duplicateOverrideReason"
                required
                hint="Required for an authorized exact-duplicate override. This reason is stored in immutable audit evidence."
              >
                <textarea
                  id="account-duplicateOverrideReason"
                  value={duplicateOverrideReason}
                  onChange={(event) => setDuplicateOverrideReason(event.currentTarget.value)}
                  rows={2}
                  minLength={10}
                />
              </FormField>
            ) : null}
          </div>
        ) : null}

        <footer className="crm-account-form-actions">
          <ActionButton onClick={close} disabled={pending}>
            Cancel
          </ActionButton>
          <ActionButton tone="primary" type="submit" busy={pending} disabled={duplicateSaveBlocked}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create account"}
          </ActionButton>
        </footer>
      </form>
    </LeadWorkspaceDrawer>
  );
}
