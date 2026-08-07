# Editorial Standards

Operational standards for writing and reviewing Phase 6 content. The binding rules live in `.claude/rules/landing-content.md` — this doc explains how those rules were actually applied, with real examples from this phase's content.

## Evidence standard in practice

Every Vercentlabs-specific claim in a resource guide, glossary entry, or comparison traces to `docs/landing-redesign/phase-1/product-intelligence.md` or real code — never invented. Concretely, this meant:

- The manufacturing guide states plainly that MRP runs are "triggered manually today... no automatic scheduler" rather than implying automation that doesn't exist.
- The migration guide explicitly warns readers to be "skeptical of any vendor claiming a fully automated, zero-manual-verification migration" — including, implicitly, Vercentlabs' own future marketing.
- The comparison page states "Vercentlabs does not currently publish public per-seat pricing... This comparison does not estimate or imply a Vercentlabs price point" rather than inventing a plausible-sounding number.

## Vendor-neutral vs. Vercentlabs-specific content — kept structurally separate

Two resource guides (`erp-buying-guide`, `erp-implementation-checklist`) are explicitly scoped to remain useful to a buyer evaluating *any* ERP, not just Vercentlabs. This is enforced, not just aspirational: `resource-content.test.mjs` includes a dedicated test checking the implementation checklist doesn't duplicate `/implementation`'s Vercentlabs-specific framing. Where these guides do mention Vercentlabs, it's a single clearly-scoped closing section ("Where Vercentlabs fits into this framework"), not blended throughout.

## Terminology consistency

Canonical module/workflow names (per `entity-architecture.md`) are used verbatim in resource and glossary copy — e.g. "HR & Payroll," never "Human Resources" alone when payroll is the actual topic. The one real naming collision found this phase (`entity-architecture.md`'s "Workflow Automation" finding) was fixed at the source (renaming the solution page), not patched around in copy.

## No keyword stuffing, no thin content

Every resource guide has real, substantial prose (multiple full paragraphs per section, not keyword-dense bullet fragments). The glossary deliberately caps standalone pages at 11 (not all 27 terms), because forcing every term through the full 9-part standalone treatment would have produced several genuinely thin pages — see `glossary-architecture.md`'s quality gate.

## Comparison neutrality

Every comparison claim is framed as "may be a stronger fit when..." in both directions — never "Vercentlabs is better." Enforced by `comparison-content.test.mjs`'s explicit test for banned absolute-superlative phrases (`vercentlabs is better`, `superior to`, `outperforms`, etc.), not just a style guideline.

## Review discipline

Every substantial piece of content went through: (1) initial drafting grounded in cited sources, (2) an automated test pass (banned-phrase scans, uniqueness checks, evidence-resolution checks), (3) Cycle 1 self-review against a real rendered build, (4) Cycle 2 parallel specialist review (see `visual-review-log.md`), (5) Cycle 3 full regression. No page skipped a stage.
