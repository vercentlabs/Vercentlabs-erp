# Conversion Form Specification — `/book-demo`

## Fields

| Field | Required | Notes |
|---|---|---|
| `firstName` | **Yes** | |
| `lastName` | No | |
| `email` | **Yes** | Pattern-validated (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) |
| `phone` | **Yes** | Pattern-validated (`/^[+()\d][\d\s().-]{6,19}$/`) |
| `companyName` | **Yes** | |
| `jobTitle` | No | |
| `industry` | No | Select: Manufacturing / Distribution & retail / Professional services / Other |
| `companySize` | No | Select: 1-10 / 11-50 / 51-200 / 201-500 / 500+ |
| `primaryInterest` | No | Select: CRM & Sales / Procurement & Stock / Manufacturing / Accounting & Finance / Projects / The full platform |
| `modulesOfInterest` | No | Multi-select checkboxes (CRM, Sales, Accounting, Procurement, Stock, Manufacturing) |
| `mainChallenge` | No | Free text, one sentence expected |
| `preferredContactTime` | No | Select: Morning / Afternoon / Evening / No preference |
| `consentEmail` | **Yes** (checkbox) | "I agree to be contacted by Vercentlabs about this demo request." |
| `websiteUrl`, `companyWebsiteHidden` | N/A | Honeypot — visually and semantically hidden (`aria-hidden`, off-screen, `tabIndex={-1}`); any non-empty value rejects the submission |

Only 4 real fields plus consent are required, matching `docs/landing-redesign/phase-1/conversion-architecture.md`'s single-step-form specification — see `decision-log.md` item 3 for the correction history (an earlier implementation required 9 fields and was reverted after independent UX review confirmed it was a spec violation).

## Client + server validation

`apps/landing/lib/demo-form-validation.ts` is the single validation source, imported by both `apps/landing/components/marketing/demo-form.tsx` (client-side, for immediate field-level errors and focus-management on submit) and `apps/landing/app/api/book-demo/route.ts` (server-side, authoritative — the client check is a UX convenience, never trusted alone).

## Submission path

```
Browser (DemoForm)
  → POST /api/book-demo  (Next.js Route Handler, runtime: "nodejs")
      1. Rate limit: 5 requests / 15 min / IP (apps/landing/lib/rate-limit.ts, in-memory)
      2. Re-validate with validateDemoForm (server-authoritative)
      3. deliverDemoRequest() (apps/landing/lib/crm-capture.ts, server-only)
           - Builds HMAC-SHA256 signature: sign(`${timestamp}.${fingerprint}.${rawBody}`, CRM_CAPTURE_PROXY_SECRET)
           - fingerprint = sha256(`${clientIp}|${userAgent}`)
           - POST to {APP_URL}/api/crm/public/capture/{CRM_CAPTURE_FORM_KEY}
             with headers: x-vercentlabs-capture-timestamp, x-vercentlabs-capture-fingerprint,
             x-vercentlabs-capture-signature
      4. apps/web verifies the signature (5-minute replay window), resolves the form by
         its public_key, applies the form's own required-field/rate-limit rules, and
         calls captureCrmLead() → creates a real tenant.crm_leads row
  ← { ok: true, requestId } (201) or a safe error (never echoes submitted PII in the response)
Browser → router.push(`/book-demo/thank-you?rid=${requestId}`)
```

`CRM_CAPTURE_FORM_KEY` / `CRM_CAPTURE_PROXY_SECRET` are read from `process.env` inside `crm-capture.ts` only — never imported into a `"use client"` file. If either is unset, `deliverDemoRequest` throws (loud failure in server logs) rather than silently dropping the lead.

## The receiving CRM form

Created and published this phase via `apps/landing/scripts/create-capture-form.mjs`, which logs into the synthetic "Vercent Demo Manufacturing" organization through the real `apps/web` UI/session (not raw SQL) and calls the real `POST /api/crm/lead-acquisition/forms` API twice (save, then publish) — exactly the same code path a real Vercentlabs user would exercise from the CRM's form-builder UI. The resulting `public_key` is a 36-character hex token (`tenant.crm_capture_forms.public_key`, matching the capture route's `^[0-9a-f]{36}$` validation), stored only in `apps/landing/.env.local` (gitignored, never committed).

**Production note** (also in `.env.example`): the local/dev value points at the synthetic demo org. A real production deployment must point `CRM_CAPTURE_FORM_KEY` at whatever organization and form the Vercentlabs sales team actually designates to receive marketing leads — this is a deployment-configuration step, not a code change.

## End-to-end verification performed this phase

1. Submitted a real synthetic lead (`Test`, `test.lead+e2e@vercent-demo.local`, `E2E Verification Co`) through the live `/book-demo` form against a running production build. Got a `201` with a real `requestId`, landed on `/book-demo/thank-you`.
2. Queried the database directly and confirmed the lead row existed in `tenant.crm_leads` for the "Vercent Demo Manufacturing" organization. An initial check of only the `mobile` column (empty) was misread as the phone number being dropped; a same-session speculative fix started sending it under both `phone` and `mobile`.
3. The frontend-quality review pass challenged that diagnosis against the real `services/api/src/crm.js` field mapping and the `tenant.crm_leads` schema (`phone` is its own correctly-mapped column; `normalized_phone` is generated as `COALESCE(mobile, phone)`). A direct, isolated request to the real capture endpoint with only `phone` set confirmed the column populates and normalizes correctly — `mobile` being empty was expected behavior, not data loss.
4. The speculative `mobile` field was reverted (see `decision-log.md` item 7); the form continues to send `phone` only, which was correct all along. All synthetic test leads created during this verification were deleted from the demo org afterward.

## What a real submission does NOT do

- Never touches the pre-existing real "VercentLabs" organization (`babdf49c-00ad-4531-a5bd-56437255b2c3`) — the form key is scoped to the synthetic demo org only, by construction (the `public_key` resolves to exactly one organization via `tenant.crm_public_capture_form()`).
- Never logs submitted PII server-side — `app/api/book-demo/route.ts`'s error logging includes only the request ID and HTTP status, never name/email/phone (see the inline comment referencing `conversion-architecture.md`'s PII-redaction rule).
