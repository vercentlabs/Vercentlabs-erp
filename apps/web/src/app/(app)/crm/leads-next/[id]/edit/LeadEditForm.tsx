"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { FormSection, RecordFormSurface, useAppForm } from "@vercentlabs/ui-web";

interface Option {
  id: string;
  name: string;
}

interface Lead {
  id: string;
  updatedAt: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  jobTitle: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  sourceId: string | null;
  referrerName: string | null;
  priority: string | null;
  rating: string | null;
  // Postgres NUMERIC columns come back through `pg` as strings (not JS
  // numbers, to avoid float precision loss) -- this field is typed honestly
  // as what the API route can actually hand back, then normalized to a
  // real number below before it ever reaches useAppForm's defaultValues.
  estimatedValue: number | string | null;
  currencyCode: string | null;
  industry: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  productInterest: string | null;
  nextFollowUpAt: string | null;
  consentEmail: boolean;
  consentSms: boolean;
  consentWhatsapp: boolean;
  doNotContact: boolean;
}

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
  priority: z.string().nullable(),
  rating: z.string().nullable(),
  estimatedValue: z.number().nullable(),
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

// See LeadCreateForm.tsx's identical helper for why: crmErrorResponse puts
// a generic "Review the submitted fields." at the top level for
// CRM_VALIDATION_ERROR, with the real per-field messages under `errors`.
function serverErrorMessage(result: { message?: string; errors?: Record<string, string[]> }): string {
  const fieldErrors = result.errors ? Object.values(result.errors).flat() : [];
  if (fieldErrors.length > 0) return fieldErrors.join(" ");
  return result.message || "Could not save this lead. Please review the fields above and try again.";
}

export function LeadEditForm({ lead, sources, currencies }: { lead: Lead; sources: Option[]; currencies: Option[] }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const form = useAppForm({
    defaultValues: {
      firstName: lead.firstName || "",
      lastName: lead.lastName || "",
      companyName: lead.companyName || "",
      jobTitle: lead.jobTitle || "",
      email: lead.email || "",
      mobile: lead.mobile || "",
      phone: lead.phone || "",
      sourceId: lead.sourceId,
      referrerName: lead.referrerName || "",
      priority: lead.priority,
      rating: lead.rating,
      estimatedValue: lead.estimatedValue == null ? null : Number(lead.estimatedValue),
      currencyCode: lead.currencyCode,
      industry: lead.industry || "",
      website: lead.website || "",
      city: lead.city || "",
      state: lead.state || "",
      countryCode: lead.countryCode || "",
      productInterest: lead.productInterest || "",
      nextFollowUpAt: lead.nextFollowUpAt || "",
      consentEmail: lead.consentEmail,
      consentSms: lead.consentSms,
      consentWhatsapp: lead.consentWhatsapp,
      doNotContact: lead.doNotContact,
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      setIsStale(false);
      const res = await fetch(`/api/crm/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...value, expectedUpdatedAt: lead.updatedAt }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        // CRM_STALE_WRITE is the real mismatch error (this form always
        // sends expectedUpdatedAt, so the "missing entirely" case,
        // CRM_LEAD_VERSION_REQUIRED, is unreachable from here in practice --
        // checked both anyway, cheaply, since the route can throw either
        // depending on exactly what's missing/wrong). Confirmed against the
        // real route by observing its actual response rather than assumed
        // from the route's own pre-check error-code name, which turned out
        // to name a different condition.
        if (result.code === "CRM_STALE_WRITE" || result.code === "CRM_LEAD_VERSION_REQUIRED") {
          setIsStale(true);
          setServerError("This lead was changed by someone else since you opened it. Refresh the page to see the latest version before saving again.");
        } else {
          setServerError(serverErrorMessage(result));
        }
        return;
      }
      router.push(`/crm/leads-next/${lead.id}`);
    },
  });

  return (
    <RecordFormSurface
      title={`Edit ${lead.firstName || "lead"}`}
      description="Owner and stage changes are not made here -- open the full workspace for those."
      serverError={serverError}
      onCancel={() => router.push(`/crm/leads-next/${lead.id}`)}
      onSubmit={(event) => {
        event.preventDefault();
        if (isStale) return;
        void form.handleSubmit();
      }}
      actions={
        <form.AppForm>
          <form.FormSubmitButton>{isStale ? "Refresh required" : "Save changes"}</form.FormSubmitButton>
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

      <FormSection title="Qualification">
        <form.AppField name="sourceId">{(field) => <field.SelectField label="Source" options={toOptions(sources)} />}</form.AppField>
        <form.AppField name="referrerName">{(field) => <field.TextField label="Referred by" />}</form.AppField>
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
