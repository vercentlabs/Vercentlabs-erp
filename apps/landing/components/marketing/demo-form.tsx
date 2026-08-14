
"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  validateDemoForm,
  type DemoFormValues,
  type DemoFormErrors,
  INDUSTRY_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  PRIMARY_INTEREST_OPTIONS,
  CONTACT_TIME_OPTIONS,
} from "@/lib/demo-form-validation";
import { LANDING_MODULES } from "@vercentlabs/landing-content";
import { getAttribution } from "@/lib/attribution";
import { track } from "@/lib/analytics";
import { FieldWrapper, FormAlert } from "@/components/forms/field";
import { Input, Textarea, Select, Checkbox } from "@/components/forms/inputs";
import { Button } from "@/components/ui/button";
import { Stack, Grid } from "@/components/layout/container";
import { Text } from "@/components/ui/text";

const EMPTY_VALUES: DemoFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  companyName: "",
  jobTitle: "",
  industry: "",
  companySize: "",
  primaryInterest: "",
  mainChallenge: "",
  preferredContactTime: "",
  consentEmail: false,
  websiteUrl: "",
  companyWebsiteHidden: "",
};

export function DemoForm({ initialModules }: { initialModules?: string[] } = {}) {
  const router = useRouter();
  const [values, setValues] = useState<DemoFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<DemoFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Preselected once from a validated ?module=/?industry=/?workflow=/?solution=
  // query param (see app/book-demo/page.tsx) — the user can still add or
  // remove modules freely afterward.
  const [modulesOfInterest, setModulesOfInterest] = useState<string[]>(initialModules ?? []);
  const formRef = useRef<HTMLFormElement>(null);
  const startedRef = useRef(false);
  // Synchronous guard against a genuine double-click sending two requests —
  // `submitting` state alone isn't enough: React batches setState, so two
  // click events dispatched in the same tick can both read `submitting` as
  // still false before the first call's setSubmitting(true) has committed.
  // A ref mutation is immediate and synchronous, closing that real race.
  // Found via a real Playwright test (tests/e2e/lead-reliability.spec.ts)
  // dispatching two native click() calls in one tick and observing 2 POSTs.
  const submittingRef = useRef(false);

  function updateField<K extends keyof DemoFormValues>(key: K, value: DemoFormValues[K]) {
    if (!startedRef.current) {
      startedRef.current = true;
      track("demo_form_start");
    }
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    const validationErrors = validateDemoForm(values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      track("demo_form_validation_error", { errorCategory: Object.keys(validationErrors).join(",") });
      const firstInvalidField = Object.keys(validationErrors)[0];
      const el = formRef.current?.querySelector<HTMLElement>(`[name="${firstInvalidField}"]`);
      el?.focus();
      return;
    }

    submittingRef.current = true;
    setErrors({});
    setSubmitError(null);
    setSubmitting(true);
    track("demo_form_submit");

    try {
      const response = await fetch("/api/book-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, modulesOfInterest, attribution: getAttribution() ?? undefined }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        if (result.errors) {
          setErrors(result.errors);
        } else {
          setSubmitError(result.error || "We couldn't submit your request. Please try again.");
        }
        track("demo_form_error", { errorCategory: String(response.status) });
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      track("demo_form_success");
      router.push(`/book-demo/thank-you?rid=${encodeURIComponent(result.requestId)}`);
    } catch {
      setSubmitError("We couldn't reach the server. Check your connection and try again.");
      track("demo_form_error", { errorCategory: "network" });
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const errorCount = Object.keys(errors).length;

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {errorCount > 0 ? (
        <FormAlert tone="error">
          {errorCount === 1 ? "One field needs attention below." : `${errorCount} fields need attention below.`}
        </FormAlert>
      ) : null}
      {submitError ? <FormAlert tone="error">{submitError}</FormAlert> : null}

      <Grid columns={2} gap={4}>
        <FieldWrapper id="firstName" label="First name" required error={errors.firstName}>
          {(describedBy) => (
            <Input id="firstName" name="firstName" autoComplete="given-name" required value={values.firstName} onChange={(e) => updateField("firstName", e.target.value)} invalid={Boolean(errors.firstName)} aria-describedby={describedBy} />
          )}
        </FieldWrapper>
        <FieldWrapper id="lastName" label="Last name">
          {(describedBy) => (
            <Input id="lastName" name="lastName" autoComplete="family-name" value={values.lastName} onChange={(e) => updateField("lastName", e.target.value)} aria-describedby={describedBy} />
          )}
        </FieldWrapper>
      </Grid>

      <Grid columns={2} gap={4}>
        <FieldWrapper id="email" label="Work email" required error={errors.email}>
          {(describedBy) => (
            <Input id="email" name="email" type="email" autoComplete="email" required value={values.email} onChange={(e) => updateField("email", e.target.value)} invalid={Boolean(errors.email)} aria-describedby={describedBy} />
          )}
        </FieldWrapper>
        <FieldWrapper id="phone" label="Phone number" required error={errors.phone}>
          {(describedBy) => (
            <Input id="phone" name="phone" type="tel" autoComplete="tel" required value={values.phone} onChange={(e) => updateField("phone", e.target.value)} invalid={Boolean(errors.phone)} aria-describedby={describedBy} />
          )}
        </FieldWrapper>
      </Grid>

      <Grid columns={2} gap={4}>
        <FieldWrapper id="companyName" label="Company name" required error={errors.companyName}>
          {(describedBy) => (
            <Input id="companyName" name="companyName" autoComplete="organization" required value={values.companyName} onChange={(e) => updateField("companyName", e.target.value)} invalid={Boolean(errors.companyName)} aria-describedby={describedBy} />
          )}
        </FieldWrapper>
        <FieldWrapper id="jobTitle" label="Your role" error={errors.jobTitle}>
          {(describedBy) => (
            <Input id="jobTitle" name="jobTitle" autoComplete="organization-title" value={values.jobTitle} onChange={(e) => updateField("jobTitle", e.target.value)} invalid={Boolean(errors.jobTitle)} aria-describedby={describedBy} />
          )}
        </FieldWrapper>
      </Grid>

      <Grid columns={2} gap={4}>
        <FieldWrapper id="industry" label="Industry" error={errors.industry}>
          {(describedBy) => (
            <Select id="industry" name="industry" value={values.industry} onChange={(e) => updateField("industry", e.target.value)} invalid={Boolean(errors.industry)} aria-describedby={describedBy}>
              <option value="">Select an industry</option>
              {INDUSTRY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          )}
        </FieldWrapper>
        <FieldWrapper id="companySize" label="Company size" error={errors.companySize}>
          {(describedBy) => (
            <Select id="companySize" name="companySize" value={values.companySize} onChange={(e) => updateField("companySize", e.target.value)} invalid={Boolean(errors.companySize)} aria-describedby={describedBy}>
              <option value="">Select a range</option>
              {COMPANY_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} employees
                </option>
              ))}
            </Select>
          )}
        </FieldWrapper>
      </Grid>

      <FieldWrapper id="primaryInterest" label="What are you most interested in?" error={errors.primaryInterest}>
        {(describedBy) => (
          <Select id="primaryInterest" name="primaryInterest" value={values.primaryInterest} onChange={(e) => updateField("primaryInterest", e.target.value)} invalid={Boolean(errors.primaryInterest)} aria-describedby={describedBy}>
            <option value="" disabled>
              Select an area
            </option>
            {PRIMARY_INTEREST_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        )}
      </FieldWrapper>

      <Stack gap={3} className="border-y border-(--color-border-default) py-5">
        <Text variant="dataLabel">Modules you&apos;re curious about (optional)</Text>
        {/* role="group"+aria-label: a screen-reader user tabbing through 12
            unrelated-sounding checkboxes ("CRM", "Sales", ...) otherwise gets
            no group context — the visible <Text> label above isn't
            programmatically associated with the checkboxes without this.
            Matches the same pattern already used in requirements-checklist.tsx. */}
        <div className="grid grid-cols-2 border-l border-t border-(--color-border-default) sm:grid-cols-3" role="group" aria-label="Modules you're curious about (optional)">
          {LANDING_MODULES.map((module) => (
            <label key={module.key} className="flex min-h-11 items-center gap-2 border-b border-r border-(--color-border-default) px-3 py-2 text-sm text-(--color-text-secondary)">
              <input
                type="checkbox"
                className="h-4 w-4 rounded-[2px] border-(--color-border-strong) text-(--color-bg-brand)"
                checked={modulesOfInterest.includes(module.name)}
                onChange={(e) =>
                  setModulesOfInterest((current) => (e.target.checked ? [...current, module.name] : current.filter((item) => item !== module.name)))
                }
              />
              {module.name}
            </label>
          ))}
        </div>
      </Stack>

      <FieldWrapper id="mainChallenge" label="What's the main challenge you're hoping to solve?" description="Optional — a sentence is plenty. We'll ask for more detail on the call.">
        {(describedBy) => (
          <Textarea id="mainChallenge" name="mainChallenge" rows={3} value={values.mainChallenge} onChange={(e) => updateField("mainChallenge", e.target.value)} aria-describedby={describedBy} />
        )}
      </FieldWrapper>

      <FieldWrapper id="preferredContactTime" label="Best time to reach you">
        {(describedBy) => (
          <Select id="preferredContactTime" name="preferredContactTime" value={values.preferredContactTime} onChange={(e) => updateField("preferredContactTime", e.target.value)} aria-describedby={describedBy}>
            <option value="">No preference</option>
            {CONTACT_TIME_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        )}
      </FieldWrapper>

      {/* Honeypot fields — visually and semantically hidden from real users, always empty on a real submission. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="websiteUrl">Leave this field empty</label>
        <input id="websiteUrl" name="websiteUrl" tabIndex={-1} autoComplete="off" value={values.websiteUrl} onChange={(e) => setValues((c) => ({ ...c, websiteUrl: e.target.value }))} />
        <label htmlFor="companyWebsiteHidden">Leave this field empty</label>
        <input id="companyWebsiteHidden" name="companyWebsiteHidden" tabIndex={-1} autoComplete="off" value={values.companyWebsiteHidden} onChange={(e) => setValues((c) => ({ ...c, companyWebsiteHidden: e.target.value }))} />
      </div>

      <Checkbox
        id="consentEmail"
        name="consentEmail"
        required
        label="I agree to be contacted by Vercentlabs about this demo request."
        checked={values.consentEmail}
        onChange={(e) => updateField("consentEmail", e.target.checked)}
        invalid={Boolean(errors.consentEmail)}
      />
      {errors.consentEmail ? (
        <p role="alert" className="text-xs font-medium text-(--color-state-error)">
          {errors.consentEmail}
        </p>
      ) : null}

      <Button type="submit" loading={submitting} disabled={submitting} className="w-full sm:w-auto sm:min-w-40">
        {submitting ? "Submitting…" : "Book a Demo"}
      </Button>
    </form>
  );
}
