# Page Differentiation Matrix

Per Workstream H — a warning system followed by human review, not an arbitrary word-uniqueness rule. Automated where the check is objective; the brand/design reviewer's judgment call on the hero-variant *distribution* (see below) is recorded honestly, including its tension, not smoothed over.

## Automated differentiation checks (all passing)

`packages/landing-content/tests/module-content.test.mjs` enforces, on every test run:

| Check | Scope |
|---|---|
| Unique `searchIntent` and `metaDescription` | All 12 modules |
| Unique `directDefinition` | All 12 modules |
| Unique `conversion.heading` (final-CTA framing) | All 12 modules |
| No duplicate FAQ question text | Across all 12 modules combined |
| No banned overclaiming/placeholder phrase (`coming soon`, `lorem ipsum`, `placeholder`, `TBD`, `TODO`, `best-in-class`, `world-class`, `industry-leading`, `#1`, `number one`) | All 12 modules + all 8 platform/product/index pages |
| Every module has ≥5 capability groups, each with real capabilities and a positive requirement count | All 12 modules |
| Unique platform-page `slug`, `title`, `metaDescription`, `directDefinition` | All 8 platform/product/index pages |

## Hero-variant distribution (a judgment call, recorded honestly)

The brand/design Cycle 2 review raised a real, fair tension worth stating plainly rather than glossing over: of the 12 module heroes, only CRM renders a genuinely screenshot-first hero; Stock and Accounting render `dashboard-led`; the remaining 9 split between `workflow-led` (Sales, Procurement, Projects, Quality) and `operational-sequence` (Manufacturing, Assets, Point of Sale, Support, HR & Payroll — 5 of 12). The reviewer's own assessment: *"It reads as 'one disciplined system, applied honestly to uneven evidence' rather than '12 pages that each feel distinct'... a defensible, arguably more honest outcome than forcing variety, but a real tension worth naming."*

This project agrees with that framing and is not going to claim otherwise: the differentiation across the 12 module pages comes primarily from **content** (each module's real, specific problems/outcomes/capabilities/workflow/FAQs — verified unique by the automated checks above) rather than from **layout variety**, because only 4 of 12 modules currently have real screenshot evidence to differentiate on layout with. This is the direct, structural consequence of `screenshot-extension-register.md`'s documented gap (9 modules with zero evidence), not a design failure independent of it. Closing the screenshot gap in a follow-up pass is the single highest-leverage way to increase real visual differentiation across the module-page set — tracked in `phase-5-brief.md`.

## What does differentiate every page, verified directly (not just asserted)

- **Direct definitions**: each module's opening answer names its specific real-world function (e.g., Quality's "enforce inspection checkpoints and disposition control," HR & Payroll's "attendance and leave, and payroll processing") — none are a generic template with only the module name swapped, confirmed by direct reading during Cycle 1/2 review, not just the uniqueness test.
- **Primary workflows**: each module's "See it work" section describes a real, distinct process (Lead to Qualified Opportunity vs. Requisition to Purchase Order vs. Inspection to CAPA) with different trigger/step/approval/outcome content — no two are structurally interchangeable.
- **Capability groups**: verified to reflect each module's actual scope (Accounting's 7 groups vs. Assets' 6, HR & Payroll's 5) rather than a fixed template count.
- **Connected-module relationships**: every `relationship` string is specific to that pairing (e.g., "Manufacturing posts real, auditable material-issue and finished-goods movements directly into the Stock ledger" vs. "Sales order lines carry a warehouse reference, but standard order fulfillment does not yet call a stock-movement post") — no generic "integrates with X" text appears anywhere.
- **Platform pages**: each of the 6 covers a genuinely distinct capability area with distinct real evidence (automation's real automated-behavior list, analytics' real report registries, mobile's honest native/handoff/absent breakdown, security's real control mechanisms) — none repeat another's content, verified by the automated metadata-uniqueness test and by direct reading.
