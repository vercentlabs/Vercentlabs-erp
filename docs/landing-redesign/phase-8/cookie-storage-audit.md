# Phase 8 Cookie and Storage Audit

## Method

A repo-wide grep for `localStorage`, `sessionStorage`, `document.cookie`, `setCookie`, and `cookies()` across every `.ts`/`.tsx` file in `apps/landing` (excluding tests), cross-referenced against each match's actual source code.

## Finding: zero cookies, anywhere

`apps/landing` sets **no cookies at all** — confirmed by the grep finding zero matches for `document.cookie`, `setCookie`, or Next.js's `cookies()` API anywhere in the application. No session cookie, no consent cookie, no tracking cookie, no A/B-test cookie (no experiment framework exists — see `phase-7/experiment-framework.md`).

## Finding: exactly 3 files use browser storage, all first-party, all documented

| File | Storage | Key | What it holds | Sent to a server? |
|---|---|---|---|---|
| `lib/attribution.ts` | `localStorage` | `vercentlabs_attribution_v1` | First-touch UTM params, landing path, referrer category, timestamp | Yes — included in the `attribution` field of a demo-request submission, if and only if you submit one. Never sent otherwise. |
| `components/resources/requirements-checklist.tsx` | `localStorage` | (checklist progress key) | Which capability groups you've marked reviewed on the ERP requirements checklist | **No** — the component's own code comment states this explicitly: "localStorage-only, never sent to analytics or a server." Verified true by reading the full component — no `fetch`/`track()` call references this state. |
| `app/book-demo/thank-you/thank-you-effects.tsx` | `sessionStorage` | (keyed by `requestId`) | A boolean flag preventing the `product_demo_complete` analytics event from firing twice if you refresh the thank-you page | No — purely a client-side dedup flag, contains no personal data, just a boolean against a non-identifying request ID. |

## No third-party trackers

Confirmed via two independent signals: (1) the CSP's `connect-src 'self'` (verified unchanged since Phase 2, re-verified this session — see `security-header-audit.md`) means the browser would block any attempt to send data to a third-party origin even if code tried; (2) `phase-7/javascript-and-bundle-audit.md`'s finding that zero third-party JavaScript exists anywhere in the shipped bundle. There is no advertising pixel, no third-party analytics tag, no chat widget, no embedded third-party iframe.

## Does this Site need a cookie-consent banner?

**No — not based on current actual behavior.** A cookie-consent banner exists, under most common regulatory frameworks including India's DPDPA, to gate *non-essential* tracking that requires informed consent before it fires (typically third-party advertising/analytics cookies). This Site has:

- No cookies of any kind.
- No third-party tracking script of any kind.
- Only first-party `localStorage`/`sessionStorage` usage that is either (a) strictly functional (the checklist progress, the dedup flag) or (b) directly tied to a request you explicitly initiate (attribution data only leaves the browser when you submit the demo form, at which point you're also providing your name/email/etc. directly and knowingly).

Building a consent banner for this Site as it exists today would be exactly the kind of "fake consent banner just because marketing sites often have one" the governing brief explicitly warns against — there is no non-essential tracking mechanism for it to gate.

## When this conclusion must be revisited

This conclusion is conditional on the site's *current* behavior, not a permanent exemption. It must be re-evaluated if any of the following becomes true in the future:

- A real analytics provider is wired to `window.__vercentlabsAnalyticsSink` (see `phase-7/observability-plan.md` — currently unattached). If that provider sets its own cookies or uses cross-site identifiers, consent gating would likely become necessary before it fires.
- Any third-party advertising, retargeting, or marketing-automation script is added.
- Any authentication/session mechanism is added to the marketing site itself (not the ERP application, which has its own separate handling).

This document should be re-read and re-verified — not assumed still true — the next time any of the above changes.

## Privacy Policy alignment

Every storage mechanism named above is described in plain language in `/privacy` (see `legal-readiness.md` for the full page). No storage mechanism exists that isn't disclosed there.
