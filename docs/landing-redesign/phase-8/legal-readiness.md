# Phase 8 Legal Readiness

**This document, and the `/privacy` and `/terms` pages it describes, are NOT legal advice and do NOT replace review by qualified counsel.** They represent a good-faith, evidence-grounded first draft based on (a) a real, verified audit of what this website actually does, and (b) current, cited research into applicable Indian data-protection law — not a generic template, and not fabricated legal conclusions.

## What was actually audited before drafting (not assumed)

Every data-collection claim in `/privacy` traces to a real source file read during this phase: `lib/attribution.ts`, `lib/analytics.ts`, `lib/web-vitals.ts`, `lib/lead-observability.ts`, `lib/rate-limit.ts`, `lib/crm-capture.ts`, `components/marketing/demo-form.tsx`, `components/resources/requirements-checklist.tsx`, `app/book-demo/thank-you/thank-you-effects.tsx` — see `cookie-storage-audit.md` for the full data-collection inventory this fed into.

## Legal research performed (cited, dated)

A live web search was performed during this phase (retrieved 2026-08-08) to verify India's current data-protection legal framework, since the company (Vercentlabs LLP) is India-based and the governing brief explicitly directs verification against current Indian sources:

- **Digital Personal Data Protection Act, 2023 (DPDPA)** — assented to by the President of India on 11 August 2023.
- **DPDP Rules, 2025** — formally notified 13 November 2025.
- **Phased implementation**, confirmed via multiple independent sources (Wikipedia's DPDPA/DPDP-Rules articles, ICLG's "Data Protection Laws and Regulations 2026 | India", DLA Piper's Data Protection Laws of the World — India page):
  - Stage 1 (13 November 2025): Data Protection Board of India established and operational.
  - Stage 2 (13 November 2026): Consent Manager registration obligations become operative.
  - Stage 3 (13 May 2027): full provisions — including detailed consent, privacy-notice, and security requirements — take effect.
- Fines for serious violations can reach ₹250 crore (~$30M USD) under the Act.

**Sources:**
- [Digital Personal Data Protection Act, 2023 — Wikipedia](https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Act,_2023)
- [Digital Personal Data Protection Rules, 2025 — Wikipedia](https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Rules,_2025)
- [Data Protection Laws and Regulations 2026 | India — ICLG](https://iclg.com/practice-areas/data-protection-laws-and-regulations/india/)
- [Data protection laws in India — DLA Piper Data Protection Laws of the World](https://www.dlapiperdataprotection.com/?t=law&c=IN)

`/privacy` reflects this research conservatively — it states the Act's phased-implementation status accurately rather than claiming full compliance obligations are already in force, and commits to reviewing the policy as the remaining stages take effect.

## Pages shipped this phase

- **`/privacy`** — real content addressing: who's covered, what's collected (voluntary form data, automatic attribution/performance/log data, checklist progress), cookies (none), how data is used, who it's shared with (no one outside Vercentlabs' own CRM), retention, user rights, security, children's privacy, applicable law, changes, contact.
- **`/terms`** — real content addressing: scope (public website only, not a SaaS customer agreement), acceptance, permitted use, IP, accuracy/availability disclaimers, demo requests (non-binding), comparison-content framing, external links, disclaimers, limitation of liability, governing law, changes, contact.

Both pages are written to read as complete and professional — no visible "TODO" or "[PLACEHOLDER]" text ships on the live page, per the governing brief's explicit instruction. Every item still requiring company/counsel input is tracked here and in `company-identity-and-trust.md` instead.

## A real BLOCKER found and fixed in Cycle 2 review: the contact mechanism didn't actually work

**Finding:** The first draft of `/privacy` referenced "the email address below" and "the address listed in our company identity documentation" for exercising data-subject rights — but neither ever actually rendered on the live page. `COMPANY_IDENTITY` (the constant meant to supply these values) was defined in `metadata.js` but never imported or referenced by `legal.js`, so a real visitor reading `/privacy` had no actual way to contact Vercentlabs about their data. Independently reproduced by Cycle 2 legal review via a live `curl`+`grep` against the rendered page, confirming zero occurrences of any email address or `vercentlabs.com`-domain contact string anywhere in the page's actual output.

**Fixed:** `legal.js` now imports `COMPANY_IDENTITY` and interpolates the real `privacyContactEmail`/`supportContactEmail` values directly into the "Your rights" and "Contact us" sections of both `/privacy` and `/terms` — verified via `pnpm typecheck`/`lint` (clean) and a rebuild+reboot showing the real email addresses now render on the live page.

## Items requiring company/counsel confirmation before final launch (not fabricated, explicitly flagged)

| Item | Current state | What's needed |
|---|---|---|
| Registered office address | Not stated on either page (no address exists anywhere in the repo) | A real, confirmed registered address from Vercentlabs |
| LLPIN | Not stated | The real LLP Identification Number |
| Contact mailbox **existence/monitoring** | **Resolved 2026-08-14:** the approved Workspace role addresses are provisioned and recorded in `docs/operations/WORKSPACE_EMAIL_DIRECTORY.md` | Keep group membership, external posting, and monitoring ownership current |
| Governing-law venue (specific courts) | States "the laws of India" generally; specific court jurisdiction marked as pending confirmation directly in the Terms text | Company/counsel to specify the exact venue |
| Limitation-of-liability and disclaimer wording | Conservative, standard draft language; the page itself states this section is intended for counsel review | Qualified legal review before treating as final for a specific commercial launch |
| Data retention specifics | States retention is "for as long as reasonably necessary," a deliberately conservative formulation avoiding an invented specific period | Company to confirm/refine if a specific retention period is decided |
| DPDPA full-compliance posture | Policy accurately describes the Act's phased rollout (full provisions effective May 2027) rather than claiming present full compliance | Re-review as remaining DPDPA stages take effect (2026-2027) |

## What was deliberately NOT done

- No cookie-consent banner was added — see `cookie-storage-audit.md`'s finding that none is currently warranted given zero cookies and zero third-party trackers.
- No fabricated processor/subprocessor list — the only data recipient described is Vercentlabs' own CRM system (the same company operating both `apps/landing` and `apps/web`), not a third party.
- No invented compliance certification (SOC 2, ISO 27001, etc.) — none is claimed anywhere, consistent with the existing footer-integrity unit test (`"footer source never claims a certification, social profile, or review badge"`, still passing).
