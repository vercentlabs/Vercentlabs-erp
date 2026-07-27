"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { value: string; label: string };
type Field = {
  name: string;
  label: string;
  type?: "text" | "date" | "number" | "select" | "checkbox";
  required?: boolean;
  defaultValue?: string | number | boolean;
  options?: Option[];
  placeholder?: string;
};

type Props = {
  title: string;
  description?: string;
  endpoint: string;
  submitLabel: string;
  fields: Field[];
  basePayload?: Record<string, unknown>;
  redirectTo?: string;
};

export default function SimpleAccountingForm({ title, description, endpoint, submitLabel, fields, basePayload = {}, redirectTo }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    setMessage("");
    try {
      const payload: Record<string, unknown> = { ...basePayload };
      for (const field of fields) {
        if (field.type === "checkbox") payload[field.name] = formData.get(field.name) === "on";
        else {
          const value = String(formData.get(field.name) ?? "").trim();
          if (value !== "") payload[field.name] = value;
        }
      }
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Accounting action failed.");
      setMessage(result.message || "Completed successfully.");
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Accounting action failed.");
    } finally {
      setPending(false);
    }
  }

  return <form className="panel accounting-form" action={submit}>
    <div><p className="eyebrow">Governed action</p><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
    <div className="accounting-form-grid">
      {fields.map((field) => <label key={field.name}>{field.label}
        {field.type === "select" ? <select name={field.name} required={field.required} defaultValue={String(field.defaultValue ?? "")}>
          <option value="">Select</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select> : field.type === "checkbox" ? <input name={field.name} type="checkbox" defaultChecked={Boolean(field.defaultValue)} /> : <input name={field.name} type={field.type || "text"} required={field.required} defaultValue={String(field.defaultValue ?? "")} placeholder={field.placeholder} />}
      </label>)}
    </div>
    <div className="accounting-form-actions"><button className="primary-button" disabled={pending} type="submit">{pending ? "Working…" : submitLabel}</button>{message ? <span>{message}</span> : null}</div>
  </form>;
}
