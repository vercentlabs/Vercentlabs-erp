"use client";

// The public web form: the fields the form asks for, the consent notice to agree to (when it has one), two hidden honeypot fields, and
// the thank-you message (or the thank-you page) once sent. Submits to /api/crm/public/capture/{key}, where the form's own rules apply.
import { useState } from "react";
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

  if (done) return <p className="text-sm" role="status">{done}</p>;
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
  return (
    <form lang={form.language ?? "en"} className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error && <Notice>{error}</Notice>}
      {form.fields.map((field) => field.type === "textarea"
        ? <TextArea key={field.name} label={field.label} isRequired={field.required} value={values[field.name] ?? ""} onChange={set(field.name)} />
        : field.type === "country"
          ? <CountrySelect key={field.name} label={field.label} isRequired={field.required} value={values[field.name] ?? ""} onChange={(value) => set(field.name)(value ?? "")} />
          : <TextField key={field.name} label={field.label} type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : field.type === "url" ? "url" : "text"}
              isRequired={field.required} value={values[field.name] ?? ""} onChange={set(field.name)} />)}
      {/* Left empty by people; filled by bots. */}
      <input type="text" name="websiteUrl" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" value={trap} onChange={(event) => setTrap(event.target.value)} />
      {form.notice && <Checkbox isSelected={agreed} onChange={setAgreed}>{form.notice.text}</Checkbox>}
      <div>
        <Button type="submit" variant="primary" isLoading={sending} isDisabled={missing.length > 0 || (Boolean(form.notice) && !agreed)}>{form.submitLabel ?? "Send"}</Button>
      </div>
    </form>
  );
}
