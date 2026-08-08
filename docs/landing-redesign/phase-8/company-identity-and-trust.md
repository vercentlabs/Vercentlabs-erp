# Phase 8 Company Identity and Trust

## Method

Rather than inventing company details for the new `/privacy` and `/terms` pages, this phase searched the existing, already-committed codebase for any real, established company identity — on the reasoning that if `apps/web` (the actual product application, built and iterated on across many more sessions than the landing site) already uses a specific legal name in production-facing content (transactional emails, account UI), that's real, verified information, not something to re-invent for the marketing site.

## What was found (real, verified)

A repo-wide search (`grep -rn "LLP\|Private Limited\|Pvt Ltd" --include="*.md" --include="*.tsx" --include="*.ts" --include="*.json"`) found:

- `apps/web/src/components/auth-card.tsx:91` — the real account/auth UI literally renders `"Vercentlabs LLP"`.
- `apps/web/src/components/onboarding-form.tsx:81` — uses `"Vercentlabs LLP"` as a placeholder example.
- `apps/web/src/lib/mailer.ts:133,221` — real, production transactional email templates (security/auth emails) sign off as `"Vercentlabs LLP"` and describe the company as `"Vercentlabs LLP · Enterprise software platform"`.

This confirms **"Vercentlabs LLP"** as the real, already-in-production legal entity name — not invented for this phase.

## Single source of truth (new this phase)

Added `COMPANY_IDENTITY` to `packages/landing-content/src/metadata.js` (exported via the package's index, typed in `index.d.ts`) — the same single-source-of-truth pattern this content package already uses for `SITE_IDENTITY`/`POSITIONING`. Every legal/company-identity string on the landing site (currently: `/privacy`, `/terms`) should reference this constant rather than a new hardcoded copy, preventing the exact "same legal name spelled two different ways across two pages" drift risk the governing brief warns about.

```js
export const COMPANY_IDENTITY = Object.freeze({
  legalName: "Vercentlabs LLP",
  entityType: "Limited Liability Partnership",
  country: "India",
  registeredAddress: null,   // real gap, see below
  llpin: null,               // real gap, see below
  privacyContactEmail: "privacy@vercentlabs.com",
  supportContactEmail: "support@vercentlabs.com",
});
```

## Real, unresolved gaps — explicitly flagged, not fabricated

Per the governing brief's explicit instruction ("Do not invent corporate details... Do not invent processor/subprocessor relationships"), the following fields are `null` or clearly flagged as unconfirmed rather than filled with an invented value:

1. **Registered office address.** No address exists anywhere in this repository. `/privacy` and `/terms` do not state a specific registered address — this is a real gap for full legal completeness (many jurisdictions' privacy-policy conventions expect one) and is listed as a launch blocker candidate in `legal-readiness.md`.
2. **LLPIN (LLP Identification Number).** India's Ministry of Corporate Affairs assigns a unique LLPIN to every registered LLP; none exists anywhere in this codebase. Not fabricated. Same blocker-candidate status.
3. **Contact email inbox confirmation.** `privacy@vercentlabs.com` and `support@vercentlabs.com` use the verified real domain (`vercentlabs.com`, per `NEXT_PUBLIC_SITE_URL`) with conventional, standard inbox-naming — but their actual existence and monitoring status is unconfirmed. This is explicitly a proposed convention pending company confirmation, not a claim that these inboxes are live today.

## Recommendation

Before this site is treated as launch-final, Vercentlabs should confirm (or correct) these 3 fields directly — at which point updating `COMPANY_IDENTITY` in the one file above propagates correctly to every page that references it, with no risk of missing a hardcoded copy elsewhere.
