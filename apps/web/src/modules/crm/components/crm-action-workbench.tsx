"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/shared/http/client-request";

export type CrmActionFieldOption = {
  label: string;
  value: string;
};

export type CrmActionField = {
  name: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "tel"
    | "number"
    | "date"
    | "datetime-local"
    | "textarea"
    | "select"
    | "checkbox"
    | "json";
  placeholder?: string;
  required?: boolean;
  path?: boolean;
  defaultValue?:
    string | number | boolean | Record<string, unknown> | unknown[];
  options?: CrmActionFieldOption[];
  help?: string;
};

export type CrmActionDefinition = {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  submitLabel?: string;
  fields?: CrmActionField[];
  fixedBody?: Record<string, unknown>;
};

type ResultState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; value: unknown }
  | { status: "error"; message: string; value?: unknown };

function initialValue(field: CrmActionField): string | boolean {
  if (field.type === "checkbox") return Boolean(field.defaultValue);
  if (field.type === "json") {
    return JSON.stringify(field.defaultValue ?? {}, null, 2);
  }
  return String(field.defaultValue ?? "");
}

function fieldValue(
  field: CrmActionField,
  form: FormData,
): string | number | boolean | unknown | undefined {
  if (field.type === "checkbox") return form.get(field.name) === "on";
  const raw = String(form.get(field.name) ?? "").trim();
  if (!raw && !field.required) return undefined;
  if (field.type === "number") {
    const number = Number(raw);
    if (!Number.isFinite(number))
      throw new Error(`${field.label} must be a number.`);
    return number;
  }
  if (field.type === "json") {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      throw new Error(`${field.label} must contain valid JSON.`);
    }
  }
  return raw;
}

export default function CrmActionWorkbench({
  title = "Operational actions",
  description = "Run governed CRM actions without leaving the workspace.",
  actions,
}: {
  title?: string;
  description?: string;
  actions: CrmActionDefinition[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(actions[0]?.id || "");
  const [result, setResult] = useState<ResultState>({ status: "idle" });
  const selected = useMemo(
    () => actions.find((action) => action.id === selectedId) || actions[0],
    [actions, selectedId],
  );

  if (!selected) return null;

  async function submit(formData: FormData) {
    setResult({ status: "submitting" });
    try {
      const body: Record<string, unknown> = { ...(selected.fixedBody || {}) };
      let endpoint = selected.endpoint;
      for (const field of selected.fields || []) {
        const value = fieldValue(field, formData);
        if (field.path) {
          if (value === undefined || value === "") {
            throw new Error(`${field.label} is required.`);
          }
          endpoint = endpoint.replace(
            `{${field.name}}`,
            encodeURIComponent(String(value)),
          );
        } else if (value !== undefined) {
          body[field.name] = value;
        }
      }
      if (endpoint.includes("{")) {
        throw new Error("A required URL identifier is missing.");
      }
      const response = await requestJson<Record<string, unknown>>(endpoint, {
        method: selected.method || "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setResult({
          status: "error",
          message: response.message || "Request failed.",
          value: response,
        });
        return;
      }
      setResult({ status: "success", value: response });
      router.refresh();
    } catch (error) {
      setResult({
        status: "error",
        message: error instanceof Error ? error.message : "Request failed.",
      });
    }
  }

  return (
    <section className="panel crm-action-workbench">
      <div className="crm-product-section-heading">
        <div>
          <p className="eyebrow">Command workspace</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <div className="crm-action-layout">
        <nav className="crm-action-list" aria-label="Available CRM actions">
          {actions.map((action) => (
            <button
              aria-current={selected.id === action.id ? "page" : undefined}
              className={selected.id === action.id ? "active" : ""}
              key={action.id}
              onClick={() => {
                setSelectedId(action.id);
                setResult({ status: "idle" });
              }}
              type="button"
            >
              <strong>{action.label}</strong>
              <span>{action.description}</span>
            </button>
          ))}
        </nav>

        <form className="crm-action-form" key={selected.id} action={submit}>
          <div className="crm-action-form-heading">
            <p className="eyebrow">{selected.label}</p>
            <h3>{selected.description}</h3>
          </div>
          <div className="crm-action-fields">
            {(selected.fields || []).map((field) => {
              const defaultValue = initialValue(field);
              if (field.type === "checkbox") {
                return (
                  <label className="crm-action-checkbox" key={field.name}>
                    <input
                      defaultChecked={Boolean(defaultValue)}
                      name={field.name}
                      type="checkbox"
                    />
                    <span>
                      <strong>{field.label}</strong>
                      {field.help ? <small>{field.help}</small> : null}
                    </span>
                  </label>
                );
              }
              return (
                <label className="crm-action-field" key={field.name}>
                  <span>
                    {field.label}
                    {field.required ? <b aria-hidden="true"> *</b> : null}
                  </span>
                  {field.type === "textarea" || field.type === "json" ? (
                    <textarea
                      defaultValue={String(defaultValue)}
                      name={field.name}
                      placeholder={field.placeholder}
                      required={field.required}
                      rows={field.type === "json" ? 8 : 4}
                    />
                  ) : field.type === "select" ? (
                    <select
                      defaultValue={String(defaultValue)}
                      name={field.name}
                      required={field.required}
                    >
                      <option value="">Select</option>
                      {(field.options || []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      defaultValue={String(defaultValue)}
                      name={field.name}
                      placeholder={field.placeholder}
                      required={field.required}
                      type={field.type || "text"}
                    />
                  )}
                  {field.help ? <small>{field.help}</small> : null}
                </label>
              );
            })}
          </div>
          <div className="form-actions crm-action-submit-row">
            <button
              className="primary-button"
              disabled={result.status === "submitting"}
              type="submit"
            >
              {result.status === "submitting"
                ? "Running…"
                : selected.submitLabel || "Run action"}
            </button>
            <code>
              {selected.method || "POST"} {selected.endpoint}
            </code>
          </div>
          <div className="crm-action-result" aria-live="polite">
            {result.status === "success" ? (
              <>
                <strong>Action completed.</strong>
                <pre>{JSON.stringify(result.value, null, 2)}</pre>
              </>
            ) : result.status === "error" ? (
              <>
                <strong>Action failed: {result.message}</strong>
                {result.value !== undefined ? (
                  <pre>{JSON.stringify(result.value, null, 2)}</pre>
                ) : null}
              </>
            ) : (
              <p>Results and validation errors will appear here.</p>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
