"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { CrmField } from "@/modules/crm";
import { requestJson } from "@/shared/http/client-request";
import { leadName, rawDefault, type Option, type Row } from "./lead-list-model";

function EditField({
  field,
  row,
  options,
}: {
  field: CrmField;
  row: Row;
  options: Record<string, Option[]>;
}) {
  if (field.type === "checkbox")
    return (
      <label className="crm-suite-check">
        <input
          name={field.name}
          type="checkbox"
          defaultChecked={Boolean(row[field.name])}
        />
        <span>{field.label}</span>
      </label>
    );
  if (field.type === "select") {
    let choices =
      field.options ||
      (field.optionsKey
        ? options[field.optionsKey]?.map((item) => ({
            value: item.id,
            label: item.name,
          }))
        : []) ||
      [];
    if (field.name === "sourceId" && row.sourceId) {
      const current = options.allSources?.find(
        (item) => item.id === String(row.sourceId),
      );
      if (current && !choices.some((choice) => choice.value === current.id))
        choices = [
          { value: current.id, label: `${current.name} — Inactive` },
          ...choices,
        ];
    }
    return (
      <label>
        <span>
          {field.label}
          {field.required ? <b>*</b> : null}
        </span>
        <select
          name={field.name}
          defaultValue={rawDefault(field, row)}
          required={field.required}
        >
          <option value="">Select</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === "textarea")
    return (
      <label className="crm-suite-span">
        <span>
          {field.label}
          {field.required ? <b>*</b> : null}
        </span>
        <textarea
          name={field.name}
          defaultValue={rawDefault(field, row)}
          required={field.required}
          rows={4}
        />
      </label>
    );
  return (
    <label>
      <span>
        {field.label}
        {field.required ? <b>*</b> : null}
      </span>
      <input
        name={field.name}
        type={field.type}
        step={field.type === "number" ? "any" : undefined}
        defaultValue={rawDefault(field, row)}
        required={field.required}
      />
    </label>
  );
}

export default function LeadEditPanel({
  row,
  fields,
  options,
  pending,
  onClose,
  onSubmit,
}: {
  row: Row;
  fields: CrmField[];
  options: Record<string, Option[]>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
}) {
  const fieldMap = new Map(fields.map((field) => [field.name, field]));
  const [duplicateDraft, setDuplicateDraft] = useState({
    firstName: String(row.firstName || ""),
    lastName: String(row.lastName || ""),
    email: String(row.email || ""),
    mobile: String(row.mobile || ""),
    phone: String(row.phone || ""),
    companyName: String(row.companyName || ""),
  });
  const [duplicateState, setDuplicateState] = useState<{
    classification: "none" | "probable" | "exact";
    matches: Row[];
    canOverride: boolean;
    checking: boolean;
  }>({
    classification: "none",
    matches: [],
    canOverride: false,
    checking: false,
  });
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    const email = duplicateDraft.email.trim();
    const mobile = duplicateDraft.mobile.replace(/\D+/g, "");
    const phone = duplicateDraft.phone.replace(/\D+/g, "");
    const hasUsefulIdentity =
      email.length > 3 ||
      mobile.length >= 7 ||
      phone.length >= 7 ||
      (duplicateDraft.firstName.trim().length > 1 &&
        duplicateDraft.companyName.trim().length > 1);
    if (!hasUsefulIdentity) {
      // The form change handler clears stale duplicate state as identity fields
      // change. Keep this effect limited to debounced external synchronization.
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDuplicateState((current) => ({ ...current, checking: true }));
      const query = new URLSearchParams({
        excludeId: String(row.id || ""),
      });
      for (const [key, value] of Object.entries(duplicateDraft)) {
        if (value.trim()) query.set(key, value.trim());
      }
      const result = await requestJson<{
        classification?: "none" | "probable" | "exact";
        matches?: Row[];
        duplicates?: Row[];
        canOverride?: boolean;
      }>(`/api/crm/leads/duplicates?${query.toString()}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setDuplicateState({
          classification: "none",
          matches: [],
          canOverride: false,
          checking: false,
        });
        return;
      }
      setDuplicateState({
        classification: result.classification || "none",
        matches: result.matches || result.duplicates || [],
        canOverride: Boolean(result.canOverride),
        checking: false,
      });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [duplicateDraft, row.id]);

  const duplicateBlocked =
    duplicateState.classification === "exact" &&
    (!duplicateState.canOverride || overrideReason.trim().length < 10);

  const groups = [
    [
      "Identity & contact",
      [
        "firstName",
        "lastName",
        "companyName",
        "jobTitle",
        "email",
        "mobile",
        "phone",
        "website",
      ],
    ],
    [
      "Ownership & attribution",
      ["companyId", "branchId", "sourceId", "referrerName"],
    ],
    [
      "Qualification",
      [
        "priority",
        "rating",
        "estimatedValue",
        "currencyCode",
        "industry",
        "productInterest",
      ],
    ],
    [
      "Location & next action",
      ["city", "state", "countryCode", "nextFollowUpAt"],
    ],
    [
      "Communication preferences",
      ["consentEmail", "consentSms", "consentWhatsapp", "doNotContact"],
    ],
  ] as const;
  return (
    <div className="crm-suite-editor">
      <header>
        <div>
          <p className="eyebrow">Edit lead</p>
          <h2 id="crm-lead-editor-title">{leadName(row)}</h2>
          <small>{String(row.code || "CRM lead")}</small>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close editor"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <form
        onSubmit={onSubmit}
        onChange={(event) => {
          const changedName = event.target.getAttribute("name") || "";
          if (
            ![
              "firstName",
              "lastName",
              "email",
              "mobile",
              "phone",
              "companyName",
            ].includes(changedName)
          )
            return;
          const form = event.currentTarget;
          const data = new FormData(form);
          // Clear the previous decision immediately in the user event, not inside
          // useEffect. This prevents a stale exact match from blocking the edit
          // while the new identity is being debounced/rechecked and satisfies
          // React 19's set-state-in-effect rule without suppressing lint.
          setDuplicateState({
            classification: "none",
            matches: [],
            canOverride: false,
            checking: false,
          });
          setOverrideReason("");
          setDuplicateDraft({
            firstName: String(data.get("firstName") ?? ""),
            lastName: String(data.get("lastName") ?? ""),
            email: String(data.get("email") ?? ""),
            mobile: String(data.get("mobile") ?? ""),
            phone: String(data.get("phone") ?? ""),
            companyName: String(data.get("companyName") ?? ""),
          });
        }}
      >
        {groups.map(([title, names]) => {
          const groupFields = names
            .map((name) => fieldMap.get(name))
            .filter((field): field is CrmField => Boolean(field));
          return groupFields.length ? (
            <section key={title}>
              <h3>{title}</h3>
              <div className="crm-suite-edit-grid">
                {groupFields.map((field) => (
                  <EditField
                    key={field.name}
                    field={field}
                    row={row}
                    options={options}
                  />
                ))}
              </div>
            </section>
          ) : null;
        })}
        {duplicateState.checking ? (
          <div className="crm-f008-edit-warning" role="status">
            Checking for matching Leads…
          </div>
        ) : duplicateState.matches.length ? (
          <section
            className={`crm-f008-edit-warning is-${duplicateState.classification}`}
            aria-live="polite"
          >
            <strong>
              {duplicateState.classification === "exact"
                ? "Matching Lead found"
                : "Possible duplicate"}
            </strong>
            <p>
              {duplicateState.matches.some((match) => match.restricted)
                ? "At least one matching Lead is outside your current record access. Its private details are not shown."
                : `Matched on ${[
                    ...new Set(
                      duplicateState.matches.flatMap((match) =>
                        Array.isArray(match.signals)
                          ? match.signals.map(String)
                          : [],
                      ),
                    ),
                  ]
                    .map((signal) => signal.replaceAll("_", " "))
                    .join(", ") || "identity information"}.`}
            </p>
            {duplicateState.classification === "exact" &&
            duplicateState.canOverride ? (
              <label>
                <span>Duplicate override reason *</span>
                <textarea
                  name="duplicateOverrideReason"
                  value={overrideReason}
                  minLength={10}
                  maxLength={1000}
                  rows={3}
                  onChange={(event) =>
                    setOverrideReason(event.currentTarget.value)
                  }
                  placeholder="Explain why this Lead must remain separate."
                />
                <small>
                  Required for an authorized exact-duplicate update and stored
                  as immutable evidence.
                </small>
              </label>
            ) : null}
          </section>
        ) : null}
        <footer>
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={pending || duplicateBlocked}
            title={
              duplicateBlocked
                ? "Resolve the exact duplicate before saving."
                : undefined
            }
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </form>
    </div>
  );
}
