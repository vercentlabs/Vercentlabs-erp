"use client";

// The public web form: the fields the form asks for, the consent notice to agree to (when it has one), two hidden honeypot fields, and
// the thank-you message (or the thank-you page) once sent. Submits to /api/crm/public/capture/{key}, where the form's own rules apply.
import { useState } from "react";
import { Check } from "lucide-react";
import { Button, Checkbox, TextArea, TextField } from "@vercentlabs/design-system";
import type { PublicCaptureForm } from "@vercentlabs/api/crm";

import { CountrySelect } from "@/features/crm/shared/ui/CountrySelect";
import { Notice } from "@/shared/ui/Panel";

export function HostedCaptureForm({ formKey, form }: { formKey: string; form: PublicCaptureForm }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);
  const [trap, setTrap] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (done) return (
    <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
      <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true"><Check className="size-6" /></span>
      <p className="text-base font-semibold text-text">Thank you</p>
      <p className="max-w-sm text-sm text-text-secondary">{done}</p>
    </div>
  );
  const missing = form.fields.filter((field) => field.required && !values[field.name]?.trim());
  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()).map(([name, value]) => [name, value.trim()]));
      if (form.notice) body.consentAccepted = agreed;
      if (trap) body.websiteUrl = trap;
      // Where the visitor came from: the page's utm_ values (an embed passes its own page's on in the iframe's address).
      const query = new URLSearchParams(window.location.search);
      for (const [param, field] of [["utm_source", "utmSource"], ["utm_medium", "utmMedium"], ["utm_campaign", "utmCampaign"]] as const)
        if (query.get(param)) body[field] = query.get(param)!.slice(0, 200);
      const response = await fetch(`/api/crm/public/capture/${formKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? result?.message ?? "The form could not be sent. Try again.");
      if (form.thankYouUrl) {
        // Embedded, the whole page moves on to the thank-you page.
        (window.top ?? window).location.href = form.thankYouUrl;
        return;
      }
      setDone(result.message ?? form.successMessage);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The form could not be sent. Try again.");
    } finally {
      setSending(false);
    }
  };
  const set = (name: string) => (value: string) => setValues((current) => ({ ...current, [name]: value }));
  const hasRequired = form.fields.some((field) => field.required) || Boolean(form.notice);
  // A short field takes half a line only when another short field shares it; one left on its own takes the full width.
  const halfWidth: boolean[] = [];
  for (let index = 0, column = 0; index < form.fields.length; index += 1) {
    const short = HALF.has(form.fields[index].name) && form.fields[index].type !== "textarea";
    const pairs = short && (column === 1 || HALF.has(form.fields[index + 1]?.name ?? ""));
    halfWidth.push(pairs);
    column = pairs ? (column + 1) % 2 : 0;
  }
  return (
    <form lang={form.language ?? "en"} className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error && <Notice>{error}</Notice>}
      {/* Short fields share a line from a tablet up; everything else takes the full width. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {form.fields.map((field, index) => {
          const span = halfWidth[index] ? "" : "sm:col-span-2";
          if (field.type === "textarea")
            return <TextArea key={field.name} className={span} label={field.label} isRequired={field.required} value={values[field.name] ?? ""} onChange={set(field.name)} />;
          if (field.type === "country")
            return <div key={field.name} className={span}><CountrySelect label={field.label} isRequired={field.required} value={values[field.name] ?? ""} onChange={(value) => set(field.name)(value ?? "")} /></div>;
          return <TextField key={field.name} className={span} label={field.label} type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : field.type === "url" ? "url" : "text"}
            autoComplete={AUTOCOMPLETE[field.name]} inputMode={field.type === "tel" ? "tel" : field.type === "email" ? "email" : undefined}
            isRequired={field.required} value={values[field.name] ?? ""} onChange={set(field.name)} />;
        })}
      </div>
      {/* Left empty by people; filled by bots. */}
      <input type="text" name="websiteUrl" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" value={trap} onChange={(event) => setTrap(event.target.value)} />
      {form.notice && <Checkbox isSelected={agreed} onChange={setAgreed}>{form.notice.text}</Checkbox>}
      <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        {hasRequired ? <p className="text-xs text-text-muted"><span className="text-danger">*</span> Required</p> : <span />}
        <Button type="submit" variant="primary" className="max-sm:w-full sm:min-w-32" isLoading={sending} isDisabled={missing.length > 0 || (Boolean(form.notice) && !agreed)}>{form.submitLabel ?? "Send"}</Button>
      </div>
    </form>
  );
}

// Fields short enough to share a line with their neighbour from a tablet up.
const HALF = new Set(["firstName", "lastName", "email", "mobile", "phone", "city", "state", "jobTitle", "companyName"]);
// What the browser may fill in for each field.
const AUTOCOMPLETE: Record<string, string> = {
  firstName: "given-name", lastName: "family-name", email: "email", mobile: "tel", phone: "tel", companyName: "organization", jobTitle: "organization-title",
  website: "url", city: "address-level2", state: "address-level1",
};
