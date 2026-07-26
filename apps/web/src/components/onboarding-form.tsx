"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import AppIcon from "@/components/app-icon";
import { requestJson } from "@/lib/client-request";

const months = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Intl.DateTimeFormat("en-IN", { month: "long" }).format(
    new Date(2026, index, 1),
  ),
}));

export default function OnboardingForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setMessage("");
    setIsError(false);

    const body = Object.fromEntries(new FormData(formElement).entries());

    const result = await requestJson<{ next?: string }>("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, { timeoutMs: 30_000 });

    setMessage(result.message || "Request completed.");
    setIsError(!result.ok);
    setPending(false);

    if (result.ok && result.next) {
      router.replace(result.next);
      router.refresh();
    }
  }

  return (
    <form className="onboarding-form" onSubmit={submit}>
      <section
        className="onboarding-form-section"
        aria-labelledby="organisation-section-title"
      >
        <div className="form-section-heading">
          <span className="form-section-number">01</span>
          <div>
            <h2 id="organisation-section-title">Organisation identity</h2>
            <p>Name the workspace and its primary legal entity.</p>
          </div>
        </div>
        <div className="form-grid two">
          <label>
            Organisation name
            <input
              autoComplete="organization"
              name="organizationName"
              placeholder="Vercentlabs"
              required
              minLength={2}
              maxLength={120}
              aria-describedby="organization-name-help"
            />
            <span className="field-help" id="organization-name-help">
              The workspace name visible to your team.
            </span>
          </label>
          <label>
            Legal company name
            <input
              autoComplete="organization"
              name="legalCompanyName"
              placeholder="Vercentlabs LLP"
              required
              minLength={2}
              maxLength={160}
              aria-describedby="legal-company-help"
            />
            <span className="field-help" id="legal-company-help">
              Use the registered entity name used on business documents.
            </span>
          </label>
        </div>
      </section>

      <section
        className="onboarding-form-section"
        aria-labelledby="operations-section-title"
      >
        <div className="form-section-heading">
          <span className="form-section-number">02</span>
          <div>
            <h2 id="operations-section-title">Operating structure</h2>
            <p>Create the primary company and branch context.</p>
          </div>
        </div>
        <div className="form-grid three">
          <label>
            Company code
            <input
              name="companyCode"
              defaultValue="VCL"
              required
              minLength={2}
              maxLength={24}
              spellCheck={false}
              aria-describedby="company-code-help"
            />
            <span className="field-help" id="company-code-help">
              A short internal identifier, such as VCL.
            </span>
          </label>
          <label>
            Primary branch
            <input
              name="branchName"
              defaultValue="Head Office"
              required
              minLength={2}
              maxLength={120}
            />
          </label>
          <label>
            Branch code
            <input
              name="branchCode"
              defaultValue="HO"
              required
              minLength={2}
              maxLength={24}
              spellCheck={false}
            />
          </label>
        </div>
      </section>

      <section
        className="onboarding-form-section"
        aria-labelledby="finance-section-title"
      >
        <div className="form-section-heading">
          <span className="form-section-number">03</span>
          <div>
            <h2 id="finance-section-title">Regional and fiscal defaults</h2>
            <p>Set the operating locale used throughout the workspace.</p>
          </div>
        </div>
        <div className="form-grid two">
          <label>
            Country code
            <input
              name="countryCode"
              defaultValue="IN"
              required
              minLength={2}
              maxLength={2}
              inputMode="text"
              spellCheck={false}
            />
          </label>
          <label>
            Base currency
            <input
              name="baseCurrency"
              defaultValue="INR"
              required
              minLength={3}
              maxLength={3}
              inputMode="text"
              spellCheck={false}
            />
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              defaultValue="Asia/Kolkata"
              required
              minLength={3}
              maxLength={80}
              spellCheck={false}
            />
          </label>
          <label>
            Financial year starts
            <select name="fiscalYearStartMonth" defaultValue="4">
              {months.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <aside
        className="onboarding-summary"
        aria-label="Workspace creation summary"
      >
        <div className="onboarding-summary-icon" aria-hidden="true">
          <AppIcon name="sparkles" size={22} />
        </div>
        <div>
          <strong>Your workspace foundation will include</strong>
          <p>
            These records are created together so the workspace starts in a
            consistent state.
          </p>
          <div className="chip-row">
            <span>Organisation</span>
            <span>Primary company</span>
            <span>Primary branch</span>
            <span>Owner access</span>
            <span>12-module registry</span>
            <span>Numbering defaults</span>
          </div>
        </div>
      </aside>

      <div className="onboarding-submit-row">
        <div>
          <strong>Ready to create the workspace?</strong>
          <span>You can add companies, branches and users after setup.</span>
        </div>
        <button
          className="primary-button large"
          type="submit"
          disabled={pending}
        >
          {pending ? "Creating workspace…" : "Create ERP workspace"}
          {!pending ? <AppIcon name="arrow-right" size={18} /> : null}
        </button>
      </div>

      {message ? (
        <p
          className={`notice${isError ? " error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
