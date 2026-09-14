"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { FormSection, RecordFormSurface, useAppForm } from "@vercentlabs/ui-web";

interface Option {
  id: string;
  name: string;
}

// TanStack Form requires the onChange schema's input type to structurally
// match the full form value shape, so every field is listed here -- but
// `firstName` is the ONLY one with a real constraint. Everything else
// (email format, at-least-one-contact-method, UUID shape, ...) is real
// backend validation in
// crm-data-operations-and-customization/input-validation.ts and is
// deliberately left to the server response, not duplicated here.
const schema = z.object({
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string(),
  companyName: z.string(),
  jobTitle: z.string(),
  email: z.string(),
  mobile: z.string(),
  phone: z.string(),
  sourceId: z.string().nullable(),
  referrerName: z.string(),
  ownerUserId: z.string().nullable(),
  priority: z.string(),
  rating: z.string(),
  estimatedValue: z.number(),
  currencyCode: z.string().nullable(),
  industry: z.string(),
  website: z.string(),
  city: z.string(),
  state: z.string(),
  countryCode: z.string(),
  productInterest: z.string(),
  nextFollowUpAt: z.string(),
  consentEmail: z.boolean(),
  consentSms: z.boolean(),
  consentWhatsapp: z.boolean(),
  doNotContact: z.boolean(),
});

function toOptions(items: Option[]) {
  return items.map((item) => ({ value: item.id, label: item.name }));
}

// crmErrorResponse (crm-data-operations-and-customization/http-errors.ts)
// puts a generic "Review the submitted fields." at the top level for
// CRM_VALIDATION_ERROR and the real per-field messages under `errors` --
// found by the create E2E journey when a lead with no contact method got
// only the generic message instead of "Provide at least one contact
// method...". Surfaces the real messages when present instead of the
// generic fallback.
function serverErrorMessage(result: { message?: string; errors?: Record<string, string[]> }): string {
  const fieldErrors = result.errors ? Object.values(result.errors).flat() : [];
  if (fieldErrors.length > 0) return fieldErrors.join(" ");
  return result.message || "Could not create this lead. Please review the fields above and try again.";
}

export function LeadCreateForm({ sources, owners, currencies }: { sources: Option[]; owners: Option[]; currencies: Option[] }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: {
      firstName: "",
      lastName: "",
      companyName: "",
      jobTitle: "",
      email: "",
      mobile: "",
      phone: "",
      sourceId: null as string | null,
      referrerName: "",
      ownerUserId: null as string | null,
      // priority/rating/estimatedValue are NOT NULL columns in
      // tenant.crm_leads (database/tenant/migrations/002_crm_module.sql) --
      // sending an explicit `null` for any of them fails with a raw
      // Postgres constraint violation rather than a clean validation
      // message, found by the create E2E journey actually running against
      // the real database. Defaulted to match the column's own DB DEFAULT
      // rather than left null.
      priority: "medium",
      rating: "warm",
      estimatedValue: 0,
      currencyCode: null as string | null,
      industry: "",
      website: "",
      city: "",
      state: "",
      countryCode: "",
      productInterest: "",
      nextFollowUpAt: "",
      consentEmail: false,
      consentSms: false,
      consentWhatsapp: false,
      doNotContact: false,
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(value),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        setServerError(serverErrorMessage(result));
        return;
      }
      router.push(`/crm/leads-next/${result.record.id}`);
    },
  });

  return (
    <RecordFormSurface
      title="New lead"
      description="Capture a new enquiry. Fields marked required must be filled in; everything else can be completed later."
      serverError={serverError}
      onCancel={() => router.push("/crm/leads-next")}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      actions={
        <form.AppForm>
          <form.FormSubmitButton>Create lead</form.FormSubmitButton>
        </form.AppForm>
      }
    >
      <FormSection title="Contact">
        <form.AppField name="firstName">{(field) => <field.TextField label="First name" required />}</form.AppField>
        <form.AppField name="lastName">{(field) => <field.TextField label="Last name" />}</form.AppField>
        <form.AppField name="email">{(field) => <field.TextField label="Email" type="email" />}</form.AppField>
        <form.AppField name="mobile">{(field) => <field.TextField label="Mobile number" />}</form.AppField>
        <form.AppField name="phone">{(field) => <field.TextField label="Alternate number" />}</form.AppField>
        <form.AppField name="jobTitle">{(field) => <field.TextField label="Job title" />}</form.AppField>
      </FormSection>

      <FormSection title="Company">
        <form.AppField name="companyName">{(field) => <field.TextField label="Company / organisation" />}</form.AppField>
        <form.AppField name="industry">{(field) => <field.TextField label="Industry" />}</form.AppField>
        <form.AppField name="website">{(field) => <field.TextField label="Website" />}</form.AppField>
        <form.AppField name="city">{(field) => <field.TextField label="City" />}</form.AppField>
        <form.AppField name="state">{(field) => <field.TextField label="State" />}</form.AppField>
        <form.AppField name="countryCode">{(field) => <field.TextField label="Country code" />}</form.AppField>
      </FormSection>

      <FormSection title="Qualification and assignment">
        <form.AppField name="sourceId">{(field) => <field.SelectField label="Source" options={toOptions(sources)} />}</form.AppField>
        <form.AppField name="referrerName">{(field) => <field.TextField label="Referred by" />}</form.AppField>
        <form.AppField name="ownerUserId">{(field) => <field.SelectField label="Owner" options={toOptions(owners)} />}</form.AppField>
        <form.AppField name="priority">
          {(field) => (
            <field.SelectField
              label="Priority"
              options={["low", "medium", "high", "urgent"].map((value) => ({ value, label: value }))}
            />
          )}
        </form.AppField>
        <form.AppField name="rating">
          {(field) => <field.SelectField label="Rating" options={["cold", "warm", "hot"].map((value) => ({ value, label: value }))} />}
        </form.AppField>
        <form.AppField name="estimatedValue">{(field) => <field.NumberField label="Estimated value" min={0} />}</form.AppField>
        <form.AppField name="currencyCode">{(field) => <field.SelectField label="Currency" options={toOptions(currencies)} />}</form.AppField>
        <form.AppField name="nextFollowUpAt">{(field) => <field.DateTimeField label="Next follow-up" />}</form.AppField>
        <form.AppField name="productInterest">{(field) => <field.TextareaField label="Product interest" />}</form.AppField>
      </FormSection>

      <FormSection title="Consent" description="Required before contacting this lead through the corresponding channel.">
        <form.AppField name="consentEmail">{(field) => <field.CheckboxField label="Email consent" />}</form.AppField>
        <form.AppField name="consentSms">{(field) => <field.CheckboxField label="SMS consent" />}</form.AppField>
        <form.AppField name="consentWhatsapp">{(field) => <field.CheckboxField label="WhatsApp consent" />}</form.AppField>
        <form.AppField name="doNotContact">{(field) => <field.CheckboxField label="Do not contact" />}</form.AppField>
      </FormSection>
    </RecordFormSurface>
  );
}
