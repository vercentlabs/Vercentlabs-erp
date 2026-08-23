"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import { requestJson } from "@/shared/http/client-request";

type Option = {
  id: string;
  name: string;
  pipelineId?: string;
};

type DuplicateLead = {
  id?: string;
  code?: string;
  fullName?: string;
  full_name?: string;
  companyName?: string;
  company_name?: string;
  email?: string;
  mobile?: string;
  phone?: string;
  status?: string;
  matchScore?: number;
  match_score?: number;
};

type CreateResponse = {
  record?: Record<string, unknown>;
  errors?: Record<string, string[]>;
};

const LEAD_FIELDS = [
  "companyId",
  "branchId",
  "firstName",
  "lastName",
  "companyName",
  "jobTitle",
  "email",
  "mobile",
  "phone",
  "sourceId",
  "campaignId",
  "ownerUserId",
  "status",
  "priority",
  "rating",
  "estimatedValue",
  "currencyCode",
  "industry",
  "website",
  "city",
  "state",
  "productInterest",
  "nextFollowUpAt",
] as const;

const CHECKBOX_FIELDS = [
  "consentEmail",
  "consentSms",
  "consentWhatsapp",
  "doNotContact",
] as const;

type FieldName = (typeof LEAD_FIELDS)[number] | (typeof CHECKBOX_FIELDS)[number];

function formBody(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form);
  const body: Record<string, unknown> = {};

  for (const name of LEAD_FIELDS) {
    body[name] = String(data.get(name) ?? "");
  }
  for (const name of CHECKBOX_FIELDS) {
    body[name] = data.get(name) === "on";
  }

  return body;
}

function duplicateTitle(duplicate: DuplicateLead) {
  return (
    duplicate.fullName ||
    duplicate.full_name ||
    duplicate.companyName ||
    duplicate.company_name ||
    duplicate.email ||
    duplicate.mobile ||
    "Existing lead"
  );
}

function duplicateScore(duplicate: DuplicateLead) {
  const score = Number(duplicate.matchScore ?? duplicate.match_score ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function prettyStatus(value: unknown) {
  return String(value || "existing")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export default function CrmLeadCreateWorkspace({
  options,
  onCancel,
}: {
  options: Record<string, Option[]>;
  onCancel: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [duplicateInputs, setDuplicateInputs] = useState({
    email: "",
    mobile: "",
    phone: "",
    companyName: "",
  });
  const [duplicateStatus, setDuplicateStatus] = useState<
    "idle" | "checking" | "ready" | "error"
  >("idle");
  const [duplicates, setDuplicates] = useState<DuplicateLead[]>([]);

  const optionList = (key: string) => options[key] ?? [];

  const duplicateSignature = useMemo(
    () =>
      [
        duplicateInputs.email.trim().toLowerCase(),
        duplicateInputs.mobile.replace(/\D+/g, ""),
        duplicateInputs.phone.replace(/\D+/g, ""),
        duplicateInputs.companyName.trim().toLowerCase(),
      ].join("|"),
    [
      duplicateInputs.companyName,
      duplicateInputs.email,
      duplicateInputs.mobile,
      duplicateInputs.phone,
    ],
  );

  useEffect(() => {
    const email = duplicateInputs.email.trim();
    const validEmail =
      email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const mobileDigits = duplicateInputs.mobile.replace(/\D+/g, "");
    const phoneDigits = duplicateInputs.phone.replace(/\D+/g, "");

    const hasStrongIdentity =
      (validEmail && email.length > 3) ||
      mobileDigits.length >= 7 ||
      phoneDigits.length >= 7;

    if (!hasStrongIdentity) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDuplicateStatus("checking");
      const query = new URLSearchParams();
      if (validEmail && email) query.set("email", email);
      if (duplicateInputs.mobile.trim())
        query.set("mobile", duplicateInputs.mobile.trim());
      if (duplicateInputs.phone.trim())
        query.set("phone", duplicateInputs.phone.trim());
      if (duplicateInputs.companyName.trim())
        query.set("companyName", duplicateInputs.companyName.trim());

      try {
        const result = await requestJson<{ duplicates?: DuplicateLead[] }>(
          `/api/crm/leads/duplicates?${query.toString()}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setDuplicates([]);
          setDuplicateStatus("error");
          return;
        }
        setDuplicates(result.duplicates ?? []);
        setDuplicateStatus("ready");
      } catch {
        if (!controller.signal.aborted) {
          setDuplicates([]);
          setDuplicateStatus("error");
        }
      }
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [duplicateSignature, duplicateInputs]);

  function errorFor(name: FieldName) {
    return fieldErrors[name]?.[0] || "";
  }

  function errorId(name: FieldName) {
    return `lead-${name}-error`;
  }

  function duplicateInput(
    key: keyof typeof duplicateInputs,
    value: string,
  ) {
    setDuplicates([]);
    setDuplicateStatus("idle");
    setDuplicateInputs((current) =>
      current[key] === value ? current : { ...current, [key]: value },
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    setFieldErrors({});

    try {
      const result = await requestJson<CreateResponse>("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formBody(form)),
      });

      if (!result.ok) {
        const errors = result.errors ?? {};
        setFieldErrors(errors);
        setMessage(result.message || "Lead could not be created.");

        const firstField = Object.keys(errors)[0];
        if (firstField) {
          window.setTimeout(() => {
            formRef.current
              ?.querySelector<HTMLElement>(`[name="${firstField}"]`)
              ?.focus();
          }, 0);
        }
        return;
      }

      const id = String(result.record?.id ?? "");
      setMessage(result.message || "Lead created.");
      if (id) {
        router.push(`/crm/leads/${id}`);
      } else {
        router.push("/crm/leads");
        router.refresh();
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Lead could not be created.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="crm-lead-create-shell">
      <section className="crm-lead-create-command">
        <div className="crm-lead-create-command__copy">
          <Link className="crm-lead-create-back" href="/crm/leads">
            <AppIcon name="arrow-right" size={15} />
            Leads
          </Link>
          <p className="eyebrow">CRM · Lead management</p>
          <h1>Create lead</h1>
          <p>
            Capture enough context to make the enquiry actionable now. Scoring,
            assignment, qualification, nurture and conversion continue after
            the lead is saved.
          </p>
        </div>

        <div className="crm-lead-create-command__actions">
          <span className="crm-lead-required-note">
            <span aria-hidden="true">*</span> Required fields
          </span>
          <button
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            form="crm-lead-create-form"
            disabled={pending}
          >
            {pending ? "Saving…" : "Save lead"}
          </button>
        </div>
      </section>

      {message ? (
        <p
          className={`notice crm-lead-create-notice${fieldErrors && Object.keys(fieldErrors).length ? " error" : ""}`}
          role="status"
        >
          {message}
        </p>
      ) : null}

      <div className="crm-lead-create-layout">
        <form
          ref={formRef}
          id="crm-lead-create-form"
          className="crm-lead-create-form"
          onSubmit={submit}
        >
          <section
            className="crm-lead-form-section"
            aria-labelledby="lead-identity-title"
          >
            <div className="crm-lead-form-section__heading">
              <span className="crm-lead-section-icon" aria-hidden="true">
                <AppIcon name="crm" size={19} />
              </span>
              <div>
                <p className="eyebrow">01 · Identity</p>
                <h2 id="lead-identity-title">Lead identity</h2>
                <p>
                  Who is enquiring and which organisation are they associated
                  with?
                </p>
              </div>
            </div>

            <div className="crm-lead-field-grid">
              <label>
                <span>
                  First name <b aria-hidden="true">*</b>
                </span>
                <input
                  autoComplete="given-name"
                  name="firstName"
                  required
                  aria-invalid={Boolean(errorFor("firstName"))}
                  aria-describedby={
                    errorFor("firstName") ? errorId("firstName") : undefined
                  }
                />
                {errorFor("firstName") ? (
                  <small
                    className="field-error"
                    id={errorId("firstName")}
                    role="alert"
                  >
                    {errorFor("firstName")}
                  </small>
                ) : null}
              </label>

              <label>
                <span>Last name</span>
                <input autoComplete="family-name" name="lastName" />
              </label>

              <label>
                <span>Company / organisation</span>
                <input
                  autoComplete="organization"
                  name="companyName"
                  onChange={(event) =>
                    duplicateInput("companyName", event.currentTarget.value)
                  }
                />
              </label>

              <label>
                <span>Job title</span>
                <input
                  autoComplete="organization-title"
                  name="jobTitle"
                  placeholder="e.g. Operations Head"
                />
              </label>
            </div>
          </section>

          <section
            className="crm-lead-form-section"
            aria-labelledby="lead-contact-title"
          >
            <div className="crm-lead-form-section__heading">
              <span className="crm-lead-section-icon" aria-hidden="true">
                <AppIcon name="profile" size={19} />
              </span>
              <div>
                <p className="eyebrow">02 · Reachability</p>
                <h2 id="lead-contact-title">Contact details</h2>
                <p>
                  Provide reliable channels for follow-up and duplicate
                  protection.
                </p>
              </div>
            </div>

            <div className="crm-lead-field-grid">
              <label>
                <span>Work email</span>
                <input
                  autoComplete="email"
                  inputMode="email"
                  name="email"
                  type="email"
                  aria-invalid={Boolean(errorFor("email"))}
                  aria-describedby={
                    errorFor("email") ? errorId("email") : undefined
                  }
                  onChange={(event) =>
                    duplicateInput("email", event.currentTarget.value)
                  }
                />
                {errorFor("email") ? (
                  <small
                    className="field-error"
                    id={errorId("email")}
                    role="alert"
                  >
                    {errorFor("email")}
                  </small>
                ) : null}
              </label>

              <label>
                <span>
                  Mobile number <b aria-hidden="true">*</b>
                </span>
                <input
                  autoComplete="tel"
                  inputMode="tel"
                  name="mobile"
                  required
                  aria-invalid={Boolean(errorFor("mobile"))}
                  aria-describedby={
                    errorFor("mobile") ? errorId("mobile") : undefined
                  }
                  onChange={(event) =>
                    duplicateInput("mobile", event.currentTarget.value)
                  }
                />
                {errorFor("mobile") ? (
                  <small
                    className="field-error"
                    id={errorId("mobile")}
                    role="alert"
                  >
                    {errorFor("mobile")}
                  </small>
                ) : null}
              </label>

              <label>
                <span>Alternate number</span>
                <input
                  autoComplete="tel"
                  inputMode="tel"
                  name="phone"
                  onChange={(event) =>
                    duplicateInput("phone", event.currentTarget.value)
                  }
                />
              </label>

              <label>
                <span>Website</span>
                <input
                  autoComplete="url"
                  inputMode="url"
                  name="website"
                  placeholder="https://example.com"
                />
              </label>
            </div>
          </section>

          <section
            className="crm-lead-form-section"
            aria-labelledby="lead-acquisition-title"
          >
            <div className="crm-lead-form-section__heading">
              <span className="crm-lead-section-icon" aria-hidden="true">
                <AppIcon name="sales" size={19} />
              </span>
              <div>
                <p className="eyebrow">03 · Acquisition</p>
                <h2 id="lead-acquisition-title">Source &amp; ownership</h2>
                <p>
                  Preserve attribution and place the lead in the correct
                  operating context.
                </p>
              </div>
            </div>

            <div className="crm-lead-field-grid">
              <label>
                <span>Lead source</span>
                <select name="sourceId" defaultValue="">
                  <option value="">Not specified</option>
                  {optionList("sources").map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Campaign</span>
                <select name="campaignId" defaultValue="">
                  <option value="">Not linked</option>
                  {optionList("campaigns").map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Owner</span>
                <select name="ownerUserId" defaultValue="">
                  <option value="">Use supported assignment policy</option>
                  {optionList("users").map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <small className="field-hint">
                  Leave blank to let the server apply any supported lead
                  assignment policy.
                </small>
              </label>

              <label>
                <span>Company context</span>
                <select name="companyId" defaultValue="">
                  <option value="">Use active company</option>
                  {optionList("companies").map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Branch context</span>
                <select name="branchId" defaultValue="">
                  <option value="">Use active branch</option>
                  {optionList("branches").map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section
            className="crm-lead-form-section"
            aria-labelledby="lead-qualification-title"
          >
            <div className="crm-lead-form-section__heading">
              <span className="crm-lead-section-icon" aria-hidden="true">
                <AppIcon name="quality" size={19} />
              </span>
              <div>
                <p className="eyebrow">04 · Qualification</p>
                <h2 id="lead-qualification-title">Commercial context</h2>
                <p>
                  Capture the signals that help teams prioritise, score and
                  qualify the enquiry.
                </p>
              </div>
            </div>

            <div className="crm-lead-field-grid">
              <label>
                <span>Status</span>
                <select name="status" defaultValue="new">
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="working">Working</option>
                  <option value="qualified">Qualified</option>
                  <option value="unqualified">Unqualified</option>
                </select>
              </label>

              <label>
                <span>Priority</span>
                <select name="priority" defaultValue="low">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>

              <label>
                <span>Rating</span>
                <select name="rating" defaultValue="cold">
                  <option value="cold">Cold</option>
                  <option value="warm">Warm</option>
                  <option value="hot">Hot</option>
                </select>
              </label>

              <label>
                <span>Industry</span>
                <input name="industry" placeholder="e.g. Manufacturing" />
              </label>

              <label>
                <span>Estimated value</span>
                <input
                  inputMode="decimal"
                  min="0"
                  name="estimatedValue"
                  step="any"
                  type="number"
                />
              </label>

              <label>
                <span>Currency</span>
                <select name="currencyCode" defaultValue="">
                  <option value="">Use CRM default</option>
                  {optionList("currencies").map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="crm-lead-field-span-2">
                <span>Product interest</span>
                <textarea
                  name="productInterest"
                  rows={4}
                  placeholder="What problem, product, service or requirement brought this lead to you?"
                />
              </label>
            </div>
          </section>

          <section
            className="crm-lead-form-section"
            aria-labelledby="lead-followup-title"
          >
            <div className="crm-lead-form-section__heading">
              <span className="crm-lead-section-icon" aria-hidden="true">
                <AppIcon name="approvals" size={19} />
              </span>
              <div>
                <p className="eyebrow">05 · Next action</p>
                <h2 id="lead-followup-title">Location &amp; follow-up</h2>
                <p>
                  Record where the lead is based and make the next contact
                  explicit.
                </p>
              </div>
            </div>

            <div className="crm-lead-field-grid">
              <label>
                <span>City</span>
                <input autoComplete="address-level2" name="city" />
              </label>

              <label>
                <span>State / region</span>
                <input autoComplete="address-level1" name="state" />
              </label>

              <label className="crm-lead-field-span-2">
                <span>Next follow-up</span>
                <input name="nextFollowUpAt" type="datetime-local" />
                <small className="field-hint">
                  Use this when the next customer action is already known.
                </small>
              </label>
            </div>
          </section>

          <fieldset
            className="crm-lead-form-section crm-lead-consent-section"
            aria-describedby="lead-consent-help"
          >
            <legend className="sr-only">Communication preferences</legend>
            <div className="crm-lead-form-section__heading">
              <span className="crm-lead-section-icon" aria-hidden="true">
                <AppIcon name="security" size={19} />
              </span>
              <div>
                <p className="eyebrow">06 · Privacy</p>
                <h2>Communication preferences</h2>
                <p id="lead-consent-help">
                  Store the permissions supplied by the lead. These controls
                  record preference; they do not send a message.
                </p>
              </div>
            </div>

            <div className="crm-lead-consent-grid">
              <label className="crm-lead-consent-card">
                <input name="consentEmail" type="checkbox" />
                <span>
                  <strong>Email consent</strong>
                  <small>Email outreach is permitted.</small>
                </span>
              </label>

              <label className="crm-lead-consent-card">
                <input name="consentSms" type="checkbox" />
                <span>
                  <strong>SMS consent</strong>
                  <small>SMS outreach is permitted.</small>
                </span>
              </label>

              <label className="crm-lead-consent-card">
                <input name="consentWhatsapp" type="checkbox" />
                <span>
                  <strong>WhatsApp consent</strong>
                  <small>WhatsApp outreach is permitted.</small>
                </span>
              </label>

              <label className="crm-lead-consent-card danger">
                <input name="doNotContact" type="checkbox" />
                <span>
                  <strong>Do not contact</strong>
                  <small>Mark this lead as unavailable for outreach.</small>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="crm-lead-create-footer-actions">
            <div>
              <strong>Ready to create this lead?</strong>
              <span>
                You can add activities, notes, communications and conversion
                actions from the lead record after saving.
              </span>
            </div>
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={pending}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={pending}>
                {pending ? "Saving…" : "Save lead"}
              </button>
            </div>
          </div>
        </form>

        <aside className="crm-lead-create-rail" aria-label="Lead creation guidance">
          <section className="crm-lead-rail-card">
            <p className="eyebrow">Lead lifecycle</p>
            <h2>Built for the complete lead journey</h2>
            <ol className="crm-lead-lifecycle">
              <li className="current">
                <span>1</span>
                <div>
                  <strong>Capture</strong>
                  <small>Identity, contact, source and consent.</small>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Qualify</strong>
                  <small>Status, priority and commercial fit.</small>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Score</strong>
                  <small>Initial score is calculated when saved.</small>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>Nurture</strong>
                  <small>Follow-up and nurture continue on the record.</small>
                </div>
              </li>
              <li>
                <span>5</span>
                <div>
                  <strong>Convert</strong>
                  <small>Create account, contact and opportunity when ready.</small>
                </div>
              </li>
            </ol>
          </section>

          <section
            className={`crm-lead-rail-card crm-lead-duplicate-card state-${duplicateStatus}`}
            aria-live="polite"
          >
            <div className="crm-lead-rail-heading">
              <span aria-hidden="true">
                <AppIcon name="search" size={18} />
              </span>
              <div>
                <p className="eyebrow">Duplicate protection</p>
                <h2>Possible existing leads</h2>
              </div>
            </div>

            {duplicateStatus === "idle" ? (
              <p>
                Enter a valid email or phone number and matching leads will be
                checked automatically.
              </p>
            ) : null}

            {duplicateStatus === "checking" ? (
              <div className="crm-lead-duplicate-status">
                <span className="crm-lead-spinner" aria-hidden="true" />
                Checking existing leads…
              </div>
            ) : null}

            {duplicateStatus === "ready" && duplicates.length === 0 ? (
              <div className="crm-lead-duplicate-clear">
                <AppIcon name="check" size={17} />
                No likely duplicate found.
              </div>
            ) : null}

            {duplicateStatus === "error" ? (
              <p>
                Duplicate preview is temporarily unavailable. The lead can
                still be validated by the server when you save.
              </p>
            ) : null}

            {duplicates.length ? (
              <div className="crm-lead-duplicate-list">
                {duplicates.slice(0, 4).map((duplicate, index) => {
                  const id = String(duplicate.id || "");
                  return (
                    <article key={id || `${duplicateTitle(duplicate)}-${index}`}>
                      <div>
                        <strong>{duplicateTitle(duplicate)}</strong>
                        <small>
                          {[
                            duplicate.companyName || duplicate.company_name,
                            duplicate.email,
                            duplicate.mobile || duplicate.phone,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                        <span>
                          {prettyStatus(duplicate.status)} · match{" "}
                          {duplicateScore(duplicate)}
                        </span>
                      </div>
                      {id ? (
                        <Link href={`/crm/leads/${id}`} target="_blank">
                          Open
                        </Link>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="crm-lead-rail-card">
            <p className="eyebrow">After save</p>
            <h2>What the system does next</h2>
            <ul className="crm-lead-system-list">
              <li>
                <AppIcon name="numbering" size={16} />
                <span>A lead code is generated.</span>
              </li>
              <li>
                <AppIcon name="sales" size={16} />
                <span>An initial lead score is calculated and recorded.</span>
              </li>
              <li>
                <AppIcon name="crm" size={16} />
                <span>
                  If no owner is selected, supported assignment rules can
                  resolve ownership.
                </span>
              </li>
              <li>
                <AppIcon name="sparkles" size={16} />
                <span>The existing lead-created automation event runs.</span>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
