> Vercentlabs Landing Redesign — Phase 1, Workstream F
> Status: Decided (target architecture). Supersede only via a new decision entry in `decision-log.md`.

## Note on "audit the existing lead flow"

The brief requires auditing the existing lead flow end-to-end and not breaking it. There is currently **no existing lead flow to audit** — `apps/landing` (including `src/lib/lead-delivery.ts`, `lead-handler.ts`, `lead-security.ts`, `lead-validation.ts`, and `src/app/api/{contact,demo,signup}/route.ts`) was deleted from the repository before this phase began, and the decision (recorded in this conversation) was to rebuild rather than restore it. This document therefore defines the **target** conversion architecture for Prompt 2/3 to implement, not a diff against a running pipeline. The deleted files' names imply the prior implementation separated validation, security (likely rate-limiting/spam control), and delivery into distinct concerns — that separation is preserved as a recommended pattern below since it is sound architecture independent of the specific prior code.

---

## Lead journey

```text
Campaign, referral or search
→ Landing page (module / industry / workflow / homepage — matched to the query)
→ Immediate category understanding (five-second message, see positioning-and-messaging)
→ Problem recognition (page-specific pain framing)
→ Relevant module, workflow or industry (internal navigation / recirculation)
→ Product evidence (real screenshots, workflow walkthroughs)
→ Trust and risk reduction (security, implementation, honest scope)
→ Demo conversion (book-demo form)
→ Lead delivery (validated, attributed, delivered to sales)
→ Sales qualification (CRM handoff)
```

## CTA hierarchy

**Primary conversion (site-wide, every page):** Book a Product Demo.

**Secondary conversions (context-dependent):**
- Explore the Platform — from homepage/product pages, for visitors not yet ready to talk to sales.
- Explore Modules — from homepage, for visitors self-sorting by domain.
- Watch Product Tour — from hero and module pages, for visitors who want to see before they book.
- See How It Works — from industry/workflow pages.
- Talk to an ERP Specialist — an alternate framing of the primary CTA for pages targeting a buying-committee member (security, implementation) rather than an operator.

**CTA wording rule:** never generic ("Learn More", "Get Started") — always name the action and, where space allows, the object ("Book a Demo", "See the Manufacturing Module", "Talk to a Specialist").

**Placement:** sticky header CTA (Book a Demo) on every page; a second contextual CTA block after the proof section of every module/industry/workflow page; a final full-width CTA block before the footer on every page.

**Mobile CTA behaviour:** header CTA collapses to a persistent bottom-anchored button (not a hamburger-hidden link) — demo conversion must never require opening the mobile nav menu.

## Demo form

**Entry points:** header CTA, every page's mid-page and footer CTA blocks, `/book-demo` (canonical destination for all of them — CTAs deep-link with a `source` query param for attribution, they do not each render their own form).

**Form progression:** single-step for the primary path (no multi-step wizard — mid-market buyers abandon multi-step forms; qualification happens via sales follow-up, not form friction).

**Required fields:** Full name, work email, company name, phone (for scheduling).
**Optional qualification fields:** company size band, primary module of interest (pre-filled from the referring page when available — e.g. arriving from `/modules/manufacturing` pre-selects "Manufacturing"), current tools in use (free text, optional).

**Error recovery:** inline field-level validation, no full-page reload on error, submitted values preserved on validation failure.

**Success experience:** on-page success state (not a redirect that loses context) confirming submission, with a next step ("we'll reach out within one business day") and a secondary path to continue browsing (link to Product Tour or the module page they came from) — avoids a dead-end thank-you page per the brief's product-tour-continuation requirement. A dedicated `/request-received` route MAY still exist for direct-link/deep-link submissions but the in-page success state is the default experience for the embedded forms.

**Spam control and duplicate prevention:** server-side rate limiting per IP/email, a honeypot field (no visible CAPTCHA — CAPTCHAs measurably suppress legitimate mid-market form completion), and duplicate-submission suppression keyed on email+company within a short window (repeat submissions update the existing lead record rather than creating duplicates downstream).

**CRM delivery:** validated leads are delivered to the sales inbox/CRM with full attribution payload (see below); delivery failures must be retried and logged, never silently dropped — this is the one lead-reliability requirement from the governing brief that is safety-critical regardless of which phase implements it.

## Attribution and analytics

**UTM persistence:** UTM parameters captured on landing, persisted through the session (not lost on internal navigation), and attached to the demo-form submission payload.

**Referrer capture:** first-touch referrer stored alongside UTM data; do not overwrite first-touch on internal navigation.

**Analytics events (to instrument once the analytics foundation exists in Prompt 2+):** `cta_click` (with CTA label + page + placement), `demo_form_start`, `demo_form_submit_success`, `demo_form_submit_error`, `product_tour_play`, `module_page_view`, `industry_page_view`. Event naming stays stable across the eight-stage programme so later CRO analysis (Prompt 7) has continuous data.

## What Prompt 1 does NOT implement

This document is architecture only. No lead-capture code, form components, or API routes are built in this phase — that is Prompt 2 (component primitives) and Prompt 3 (homepage) work. Phase 1's only lead-reliability obligation is documenting this target so later phases don't reinvent it, and — per the governing brief's "fix only serious, clearly understood lead-flow defects" instruction — there is no defect to fix because there is no lead flow currently deployed.
