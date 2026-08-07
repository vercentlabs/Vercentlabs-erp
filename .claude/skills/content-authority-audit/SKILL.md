---
name: content-authority-audit
description: Reusable page-quality audit workflow for Vercentlabs landing content — scores a resource, glossary, or comparison page against a 9-point buyer-usefulness rubric before it ships. Use before publishing any new /resources, /resources/glossary, or /compare page, or when re-auditing existing content for staleness or thinness.
---

# Content authority audit

Audits one page (or a small batch) against the publishing quality gate described in `docs/landing-redesign/phase-6/content-authority-strategy.md` and enforced conceptually by `[[landing-content rule]]` (`.claude/rules/landing-content.md`). The gate exists so raw page count never substitutes for buyer usefulness — see `rubric.md` in this directory for the full scoring criteria and worked examples.

## When to run this

- Before a new cornerstone guide, glossary standalone page, or comparison page is marked ready to route/ship.
- When `content:validate` or a visual-review cycle flags a page as weak.
- When re-reviewing older content for the freshness lifecycle (`docs/landing-redesign/phase-6/freshness-and-sitemap-policy.md`).

## How to run it

1. Read the target page's content-file entry (not the rendered HTML — the source of truth is `packages/landing-content/src/*.js`) and, if it exists, the rendered route.
2. Score each of the 9 dimensions in `rubric.md` as Pass / Weak / Fail, with one concrete sentence of evidence per score — not a bare label.
3. For any Fail, state the specific fix: cut the page, merge it into a stronger page, or name the missing content.
4. For any Weak, state whether it's shippable as-is (with a follow-up noted) or blocks publication.
5. Output a verdict: **Ship**, **Ship with follow-ups**, or **Do not ship** — plus the list of scores.

## Rubric summary (see rubric.md for full detail)

1. Buyer usefulness — would a real evaluator learn something they couldn't get from a 30-second skim of a competitor's site?
2. Originality — does this reflect Vercentlabs' actual product/data, not a repackaged generic explainer?
3. Intent differentiation — does another page already own this exact query/intent?
4. Evidence — every non-obvious claim traces to a real source (product code/docs, `product-intelligence.md`, or a tiered `EditorialSource`)?
5. Product connection — does it link to the real module/workflow/capability it discusses, not just describe ERP in the abstract?
6. Actionability — does the reader leave knowing what to do next (a decision, a checklist item, a comparison conclusion)?
7. Structure — direct-answer opening, real headings, scannable, no wall-of-text?
8. Search technical quality — unique metadata, correct canonical, valid structured data, included in sitemap with a real date?
9. Conversion relevance — is there a genuine, non-pushy path to `/book-demo` or a related resource, not a hidden content trap?

## Output format

A findings table (dimension → Pass/Weak/Fail → evidence sentence) followed by the verdict line. Do not fabricate a Pass to make a weak page look shippable — a `content-quality-auditor` subagent invoking this Skill has no authority to lower the bar (see `[[landing-content rule]]`, rule 9).
