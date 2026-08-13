# Homepage Copy Rationale

Every capability claim on the homepage traces to `docs/landing-redesign/phase-1/product-intelligence.md`, respecting its "Honest Limitations" section. This document explains the *wording* choices, not the underlying facts (those are Phase 1's job).

## Headline and positioning

**"The ERP for businesses that outgrew spreadsheets."** — kept from `docs/landing-redesign/phase-1/positioning-and-messaging.md` rather than reinvented. It names the trigger event (outgrowing spreadsheets) that the "problem" section immediately substantiates, rather than a generic "all-in-one platform" claim.

**Hero eyebrow: "Connected ERP for manufacturers and distributors"** — changed this phase from "Connected ERP for growing businesses" (generic) to name the actual ICP, matching the meta description and the SEO reviewer's finding that the hero lacked explicit audience naming. This is not a narrowing of scope — Vercentlabs' 12 modules serve more than these two segments — but manufacturers and distributors are the primary ICP per `docs/landing-redesign/phase-1/icp-and-buyer-map.md`, and naming them plainly gives both search engines and human scanners a faster relevance signal than a generic phrase would.

## Evidence-first, not adjective-first

The hero's four metrics (12 connected modules, 1,039 implemented capabilities, multi-company operating model, role-based access model) are placed directly under the primary CTA, before any qualitative claim. This mirrors `docs/landing-redesign/phase-1/creative-direction.md`'s "evidence-grounded, not adjective-heavy" instruction: a number a buyer can mentally verify (implicitly, by exploring the product) is a stronger opening than an unverifiable superlative like "the most powerful ERP."

## "1,039" is broken down, never just asserted

The breadth section exists specifically so the "1,039 implemented capabilities" number isn't a bare, unverifiable claim — it's split into 945 operational (module-specific) + 94 shared platform, with governed automation and immutable audit trail named as qualitative categories within that count. A skeptical reader can see the number is a sum of real, named categories, not a marketing round number.

## The flagship workflow is a real sequence, not an illustrative diagram

`FLAGSHIP_WORKFLOW_SECTION.supportingText` states explicitly: "This is the same sequence a real deal follows inside Vercentlabs, not a simplified diagram of how ERPs work in general." Each of the 6 steps names the specific system behavior (e.g. "Checked against the customer's live credit exposure before confirmation is allowed") rather than a generic verb ("processed"), because specific, checkable claims are what separates evidence-grounded copy from a template ERP landing page.

## What was deliberately left unsaid (Honest Limitations discipline)

Per `product-intelligence.md`'s "Honest Limitations" section, the homepage never claims:
- That a standard sales order automatically triggers a stock deduction (only Manufacturing and POS post real stock movements today) — the flagship workflow's steps stop at "Invoice posted," not "stock automatically decremented."
- Specific customer counts, revenue figures, uptime percentages, or third-party review scores — none exist yet, and none are implied by phrasing like "trusted by" or "industry-leading."
- Certifications or compliance badges (SOC 2, ISO, etc.) that the product does not hold.

## Banned-phrase enforcement is automated, not just a style guideline

`packages/landing-content/tests/landing-content.test.mjs`'s "no homepage section copy uses a banned overclaiming phrase" test greps every section's copy against a list of overclaiming patterns (e.g. bare superlatives with no evidence attached, fabricated-sounding stat patterns) so this discipline survives future copy edits without relying on a human re-reading every section by hand.

## CTA label consistency

Every primary CTA on the homepage (hero, final CTA) and the header/footer uses the exact label **"Book a Demo"** — matching `CLAUDE.md`'s stated conversion objective verbatim. This phase found and fixed one inconsistency: `packages/landing-content/src/navigation.js`'s `CTAS.primary.label` was still the shorter "Book a Demo," which had drifted out of sync with the homepage content model's CTAs. A single content-test (`no CTA uses a banned generic label`) now guards this from drifting again.
