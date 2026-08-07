# Content authority rubric — full detail

Each dimension is scored Pass / Weak / Fail. A page needs zero Fails and at most 2 Weaks to ship without follow-up work; one Fail means it doesn't ship as-is.

## 1. Buyer usefulness

**Pass:** A real ERP evaluator (any vendor, not just Vercentlabs) would learn something concrete they couldn't get from a 30-second skim of a competitor's equivalent page — a specific mechanism, a real number, a decision framework.
**Weak:** Correct but generic — the kind of explanation that could sit on any ERP vendor's site unchanged.
**Fail:** Restates the page title in more words. No real information density.

## 2. Originality

**Pass:** Grounded in Vercentlabs' actual product/data — the 1,039-requirement model, real capability groups, real screenshots, real cross-module workflows.
**Weak:** Mostly generic ERP-education content with a thin Vercentlabs mention bolted on.
**Fail:** Could be published by any vendor with a find-and-replace on the company name.

## 3. Intent differentiation

**Pass:** Owns a distinct query family per `search-intent-ownership.md`; no other route answers the same core question at the same depth.
**Weak:** Meaningful overlap with another page, but a real angle difference exists (different buyer stage, different depth).
**Fail:** Near-duplicate of an existing page's title, H1, and direct-answer opening — a cannibalisation risk, not a companion page.

## 4. Evidence

**Pass:** Every specific, non-obvious claim (a number, a competitor fact, a capability claim) traces to a real source — product code/docs for Vercentlabs claims, a tiered `EditorialSource` with a live `sourceUrl` for external claims.
**Weak:** Mostly sourced, but one or two claims are unattributed generalizations that are directionally true but not individually verified.
**Fail:** Contains a specific number, statistic, or competitor claim with no traceable source.

## 5. Product connection

**Pass:** Links to the real module/workflow/capability page(s) it discusses; a reader can go verify the claim against the live product story.
**Weak:** Mentions Vercentlabs but doesn't link to the specific relevant module/workflow.
**Fail:** Reads as a standalone ERP-education page with no connection back to the real product.

## 6. Actionability

**Pass:** The reader leaves with something concrete — a checklist item checked off, a comparison conclusion reached, a "next question to ask a vendor" identified.
**Weak:** Informative but ends without a clear next step beyond "read more."
**Fail:** Pure exposition with no actionable takeaway anywhere on the page.

## 7. Structure

**Pass:** Direct-answer opening paragraph immediately after the H1, real semantic heading hierarchy, scannable sections, no walls of undifferentiated text.
**Weak:** Structure exists but the opening paragraph doesn't actually answer the core question directly.
**Fail:** No direct-answer opening; heading hierarchy skips levels or is decorative rather than structural.

## 8. Search technical quality

**Pass:** Unique `<title>`/meta description, correct self-referencing (or intentionally aliased) canonical, valid structured data matching visible content, included in `sitemap.ts` with a real `CONTENT_FRESHNESS` date.
**Weak:** Metadata present but generic/templated rather than page-specific.
**Fail:** Missing metadata, missing sitemap entry, or structured data that doesn't match the visible page (a real GEO/AEO risk, not just an SEO nicety).

## 9. Conversion relevance

**Pass:** A genuine, contextually relevant path to `/book-demo` or a closely related resource — not forced, not blocking the informational content behind it.
**Weak:** CTA present but generic (no context param, no relevance to the page's specific topic).
**Fail:** No conversion path at all, or the informational content is gated behind a CTA (a violation of the crawlability/no-gating rule for evergreen resources).
