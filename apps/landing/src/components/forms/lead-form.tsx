"use client";

import Link from "next/link";
import { ArrowRight, Check, LoaderCircle, Mail } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";

import {
  contactInterests,
  signupInterests,
  teamSizes,
} from "@/lib/lead-validation";
import { siteConfig } from "@/lib/site-config";

type LeadFormMode = "contact" | "signup";
type FieldErrors = Record<string, string>;

type SubmissionState = {
  status: "idle" | "submitting" | "success" | "error";
  message: string;
};

export default function LeadForm({ mode }: { mode: LeadFormMode }) {
  const [submission, setSubmission] = useState<SubmissionState>({
    status: "idle",
    message: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const startedAt = useRef(0);
  const isSignup = mode === "signup";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || ""),
      company: String(formData.get("company") || ""),
      phone: String(formData.get("phone") || ""),
      interest: String(formData.get("interest") || ""),
      teamSize: String(formData.get("teamSize") || ""),
      message: String(formData.get("message") || ""),
      website: String(formData.get("website") || ""),
      consent: formData.get("consent") === "on",
      startedAt: startedAt.current,
    };

    setFieldErrors({});
    setSubmission({
      status: "submitting",
      message: "Submitting your request…",
    });

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(isSignup ? "/api/signup" : "/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        errors?: FieldErrors;
      };

      if (!response.ok || !result.ok) {
        setFieldErrors(result.errors || {});
        throw new Error(
          result.message || "The request could not be delivered.",
        );
      }

      setSubmission({
        status: "success",
        message: result.message || "Your request has been received.",
      });
      form.reset();
      startedAt.current = Date.now();

      if (isSignup) {
        window.setTimeout(() => {
          window.location.assign(
            "/signup/verify?email=" + encodeURIComponent(payload.email),
          );
        }, 700);
      }
    } catch (error) {
      setSubmission({
        status: "error",
        message:
          error instanceof DOMException && error.name === "AbortError"
            ? "The request timed out. Check your connection and try again."
            : error instanceof Error
              ? error.message
              : "The request could not be delivered.",
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      onFocusCapture={() => {
        if (startedAt.current === 0) startedAt.current = Date.now();
      }}
      className="operator-lead-form"
    >
      <div className="grid gap-3.5 sm:grid-cols-2 sm:gap-5">
        <Field
          label="Full name"
          name="name"
          autoComplete="name"
          required
          maxLength={100}
          error={fieldErrors.name}
        />
        <Field
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={160}
          error={fieldErrors.email}
        />
        <Field
          label="Organisation"
          name="company"
          autoComplete="organization"
          required
          maxLength={160}
          error={fieldErrors.company}
        />
        <Field
          label="Phone number"
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={40}
          error={fieldErrors.phone}
        />

        <SelectField
          label={isSignup ? "Main area of interest" : "Discussion area"}
          name="interest"
          required={isSignup}
          options={isSignup ? signupInterests : contactInterests}
          error={fieldErrors.interest}
        />

        {isSignup ? (
          <SelectField
            label="Approximate team size"
            name="teamSize"
            options={teamSizes}
            error={fieldErrors.teamSize}
          />
        ) : null}
      </div>

      <div className="mt-4 sm:mt-5">
        <label
          htmlFor="message"
          className="text-xs font-bold text-slate-800 sm:text-sm"
        >
          {isSignup
            ? "What should the ERP solve first?"
            : "Business problem or requirement"}
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          required={!isSignup}
          maxLength={2000}
          aria-invalid={Boolean(fieldErrors.message)}
          aria-describedby={fieldErrors.message ? "message-error" : undefined}
          className="form-control mt-1.5 sm:mt-2"
          placeholder={
            isSignup
              ? "Share the current systems, workflow, users and result you want to achieve."
              : "Describe the current process, systems, users and the problem you want to solve."
          }
        />
        <FieldError id="message-error" message={fieldErrors.message} />
      </div>

      <div
        aria-hidden="true"
        className="absolute -left-[10000px] h-px w-px overflow-hidden"
      >
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <label className="operator-lead-form__consent">
        <input
          name="consent"
          type="checkbox"
          required
          className="operator-lead-form__checkbox"
        />
        <span>
          I agree that VercentLabs may use these details to assess and respond
          to this request. Review the{" "}
          <Link href="/privacy" className="operator-inline-link">
            privacy policy
          </Link>
          .
        </span>
      </label>
      <FieldError
        id="consent-error"
        message={fieldErrors.consent || fieldErrors.form}
      />

      <button
        type="submit"
        disabled={submission.status === "submitting"}
        className="button-primary mt-5 min-h-11 w-full justify-center text-xs disabled:cursor-not-allowed disabled:opacity-60 sm:mt-6 sm:w-auto sm:text-sm"
      >
        {submission.status === "submitting" ? (
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : submission.status === "success" ? (
          <Check aria-hidden="true" className="h-4 w-4" />
        ) : (
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        )}
        {submission.status === "submitting"
          ? "Submitting…"
          : isSignup
            ? "Apply for design partnership"
            : "Send enquiry"}
      </button>

      <div aria-live="polite" className="mt-3 min-h-5 sm:mt-4 sm:min-h-6">
        {submission.message ? (
          <p
            className={
              "text-xs font-semibold sm:text-sm " +
              (submission.status === "success"
                ? "text-emerald-700"
                : submission.status === "error"
                  ? "text-rose-700"
                  : "text-slate-600")
            }
          >
            {submission.message}
          </p>
        ) : null}

        {submission.status === "error" ? (
          <a
            href={
              "mailto:" + siteConfig.email + "?subject=VercentLabs ERP enquiry"
            }
            className="operator-inline-link operator-inline-link--mail"
          >
            <Mail aria-hidden="true" className="h-4 w-4" />
            Email {siteConfig.email}
          </a>
        ) : null}
      </div>

      <noscript>
        <p className="mt-3 text-xs text-amber-800 sm:mt-4 sm:text-sm">
          JavaScript is required for secure online submission. Email{" "}
          {siteConfig.email} instead.
        </p>
      </noscript>
    </form>
  );
}

type FieldProps = {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  maxLength?: number;
  error?: string;
};

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  maxLength,
  error,
}: FieldProps) {
  const errorId = name + "-error";
  return (
    <div>
      <label
        htmlFor={name}
        className="text-xs font-bold text-slate-800 sm:text-sm"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className="form-control mt-1.5 sm:mt-2"
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

type SelectFieldProps = {
  label: string;
  name: string;
  options: readonly string[];
  required?: boolean;
  error?: string;
};

function SelectField({
  label,
  name,
  options,
  required,
  error,
}: SelectFieldProps) {
  const errorId = name + "-error";
  return (
    <div>
      <label
        htmlFor={name}
        className="text-xs font-bold text-slate-800 sm:text-sm"
      >
        {label}
      </label>
      <select
        id={name}
        name={name}
        required={required}
        defaultValue=""
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className="form-control mt-1.5 sm:mt-2"
      >
        <option value="">Select an option</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-1.5 text-xs font-semibold text-rose-700">
      {message}
    </p>
  ) : null;
}
