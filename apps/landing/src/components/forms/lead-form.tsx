"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, LoaderCircle, Mail } from "lucide-react";

import { landingConfig } from "@/lib/landing-config";

type LeadFormMode = "contact" | "signup";

type LeadFormProps = {
  mode: LeadFormMode;
};

type SubmissionState =
  | {
      status: "idle";
      message: "";
    }
  | {
      status: "submitting";
      message: string;
    }
  | {
      status: "success";
      message: string;
    }
  | {
      status: "error";
      message: string;
    };

const initialState: SubmissionState = {
  status: "idle",
  message: "",
};

export default function LeadForm({ mode }: LeadFormProps) {
  const [submission, setSubmission] = useState<SubmissionState>(initialState);

  const isSignup = mode === "signup";
  const endpoint = isSignup ? "/api/signup" : "/api/contact";

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
    };

    setSubmission({
      status: "submitting",
      message: "Submitting your request...",
    });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(
          result.message || "The request could not be delivered.",
        );
      }

      setSubmission({
        status: "success",
        message: result.message || "Your request has been received.",
      });

      form.reset();

      if (isSignup) {
        const email = encodeURIComponent(payload.email);

        window.setTimeout(() => {
          window.location.assign("/signup/verify?email=" + email);
        }, 700);
      }
    } catch (error) {
      setSubmission({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "The request could not be delivered.",
      });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Full name"
          name="name"
          autoComplete="name"
          required
          maxLength={100}
        />

        <Field
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={160}
        />

        <Field
          label="Organisation"
          name="company"
          autoComplete="organization"
          required
          maxLength={160}
        />

        <Field
          label="Phone number"
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={40}
        />

        {isSignup ? (
          <>
            <SelectField
              label="Main area of interest"
              name="interest"
              required
              options={[
                "Finance and accounting",
                "Inventory and procurement",
                "Sales and CRM",
                "Manufacturing",
                "People and payroll",
                "Projects and services",
                "Complete ERP platform",
              ]}
            />

            <SelectField
              label="Approximate team size"
              name="teamSize"
              options={["1–10", "11–50", "51–200", "201–500", "500+"]}
            />
          </>
        ) : (
          <SelectField
            label="Discussion area"
            name="interest"
            options={[
              "ERP discovery",
              "Product pilot",
              "Implementation partnership",
              "Technology integration",
              "Careers and collaboration",
              "Other",
            ]}
          />
        )}
      </div>

      <div className="mt-5">
        <label htmlFor="message" className="text-sm font-bold text-slate-800">
          {isSignup
            ? "What would you like the ERP to solve?"
            : "Business problem or requirement"}
        </label>

        <textarea
          id="message"
          name="message"
          rows={5}
          required={!isSignup}
          maxLength={2000}
          className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          placeholder={
            isSignup
              ? "Share the workflows, systems or business problems you are evaluating."
              : "Describe your current systems, workflows and the problem you want to solve."
          }
        />
      </div>

      <div
        aria-hidden="true"
        className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
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

      <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-slate-600">
        <input
          name="consent"
          type="checkbox"
          required
          className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />

        <span>
          I agree that VercentLabs may use these details to respond to this
          request. Review the{" "}
          <Link
            href="/privacy"
            className="font-bold text-indigo-600 hover:text-indigo-800"
          >
            privacy policy
          </Link>
          .
        </span>
      </label>

      <button
        type="submit"
        disabled={submission.status === "submitting"}
        className="button-primary mt-6 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {submission.status === "submitting" ? (
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : submission.status === "success" ? (
          <Check aria-hidden="true" className="h-4 w-4" />
        ) : (
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        )}

        {submission.status === "submitting"
          ? "Submitting..."
          : isSignup
            ? "Request early access"
            : "Send enquiry"}
      </button>

      <div aria-live="polite" className="mt-4 min-h-6">
        {submission.message ? (
          <p
            className={
              "text-sm font-semibold " +
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
              "mailto:" +
              landingConfig.contactEmail +
              "?subject=Vercent ERP enquiry"
            }
            className="mt-3 inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600"
          >
            <Mail aria-hidden="true" className="h-4 w-4" />
            Email {landingConfig.contactEmail}
          </a>
        ) : null}
      </div>
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
};

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  maxLength,
}: FieldProps) {
  return (
    <div>
      <label htmlFor={name} className="text-sm font-bold text-slate-800">
        {label}
      </label>

      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
        className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
      />
    </div>
  );
}

type SelectFieldProps = {
  label: string;
  name: string;
  options: string[];
  required?: boolean;
};

function SelectField({ label, name, options, required }: SelectFieldProps) {
  return (
    <div>
      <label htmlFor={name} className="text-sm font-bold text-slate-800">
        {label}
      </label>

      <select
        id={name}
        name={name}
        required={required}
        defaultValue=""
        className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
      >
        <option value="">Select an option</option>

        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
