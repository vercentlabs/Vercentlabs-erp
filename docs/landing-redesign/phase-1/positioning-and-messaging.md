> Vercentlabs Landing Redesign — Phase 1, Workstream E
> Status: Decided. Supersede only via a new decision entry in `decision-log.md`.

# Positioning and Messaging

## Testing the starting lines

**Starting category:** "Vercentlabs ERP is a connected business operating platform for managing customers, sales, procurement, inventory, employees, service, quality, retail, assets, projects and manufacturing."
**Starting promise:** "Run your entire business from one connected ERP."

Scored against the six tests:

| Test | Category line | Promise line |
|---|---|---|
| Product reality | Accurate — all 12 modules exist and share one data model | Accurate at the platform level |
| ICP needs | Too broad — lists 11 nouns, none of the three ICPs sees itself immediately | Generic — "run your entire business" is what every ERP vendor says |
| Search intent | Poor — nobody searches "connected business operating platform" | Poor — not query-shaped |
| Competitive differentiation | Weak — this sentence could be SAP's or NetSuite's | Weak — zero differentiation from category incumbents |
| Message clarity | Low — a run-on noun list is not a claim | Medium — clear but empty |
| Credibility | Neutral | Slightly inflated ("entire business" over-promises for a growing company's actual first use case) |
| Memorability | Low | Low |
| Conversion suitability | Low — doesn't tell a visitor whether to keep reading | Low |

**Verdict:** Both starting lines are directionally correct (integrated platform, broad module coverage) but fail as public-facing copy — they read as an internal capability list, not a buyer promise. Rejected as-is; kept as the accurate factual substrate underneath a sharper promise.

---

## Category

Vercentlabs is an **operational ERP for growing, multi-location businesses** — one system of record spanning sales, inventory, procurement, production, finance, and people, built so that a decision made in one module (a sales order, a purchase requisition, a work order) is immediately visible everywhere it matters, with the approvals and audit trail an owner needs to trust it.

We do not lead with "connected business operating platform" (category-abstract) or "cloud ERP" (commodity). We lead with **operational** — the product's evidence is concrete, transactional, and workflow-shaped (BOM → work order, requisition → PO → payables, lead → quotation → order → invoice), not dashboard-abstract.

## Audience

A business that has outgrown accounting-software-plus-spreadsheets but is not the enterprise buyer that SAP/Oracle/Dynamics target. Concretely: the three ICPs in [[icp-and-buyer-map]] — growing manufacturers, multi-location distributors/retailers, and project-based services businesses. The recognisable self-description: "we're running on Tally/Zoho/Excel/WhatsApp and it's starting to break."

## Problem

Growth exposes the seams between disconnected tools. Data that should be one fact (how much stock exists, what a project actually costs, whether an invoice is approved) exists in three places and agrees in none of them. The operational cost isn't abstract — it's stockouts, missed deliveries, month-end guesswork, and decisions made on stale numbers.

## Promise

**Every part of the business runs on the same live numbers — because it's the same system, not five that happen to export to Excel.**

## Differentiators

1. **Genuinely integrated, not bundled.** The 12 modules share one data model and one permission/approval layer (evidenced by shared platform capabilities: roles/permissions, approval workflows, audit trail, module entitlements — see [[product-intelligence]]), not separately acquired products wearing one login screen.
2. **Built for the mid-market's actual complexity**, not a simplified SMB tool or an enterprise platform that requires a systems integrator to configure.
3. **Workflow-first, not form-first.** The product is organised around the real sequences a business runs (quote to order, requisition to purchase, plan to production) rather than a flat list of masters and transactions.
4. **Transparent about scope.** Vercentlabs states plainly what's live today per module rather than a marketing feature list that outruns the product (see Evidence and Honesty Rules in the governing brief).

## Reasons to believe

- Twelve operational modules and a shared platform layer exist in one codebase and one data model today (not a roadmap) — Shared Platform, CRM, Sales, Accounting, Procurement, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll.
- Role-based permissions, approval workflows, and an immutable audit trail are present across modules (`apps/web/src/app/(app)/approvals`, `apps/web/src/app/(app)/audit-logs`, `apps/web/src/app/(app)/settings/roles` — see [[product-intelligence]] for the full evidence trail).
- Multi-company and branch-level data isolation is implemented at the database layer, not bolted on.
- Native mobile access exists alongside the web application (`apps/mobile`), not a responsive-only afterthought.
- Cross-module workflows are traceable in the actual codebase (e.g. an opportunity becoming a quotation becoming a sales order becoming a receivable), not just described in sales collateral.

## Objection responses

| Objection | Response |
|---|---|
| "ERPs fail to implement." | Lead with implementation methodology and scope transparency (state what's live per module honestly) rather than overselling; publish a clear go-live process page. |
| "We already use point tools that work." | Reposition Vercentlabs as the system of record underneath, not a forced replacement of every tool on day one; module pages should acknowledge coexistence paths (import/export, APIs) where real. |
| "This looks like every other ERP homepage." | Creative direction (see [[creative-direction]]) and product-evidence-first content (real screens, real workflows) are the differentiation mechanism — copy alone can't solve this. |
| "Is this actually used by real companies?" | Per Evidence and Honesty Rules, do not fabricate logos/testimonials. Substitute real product screenshots, workflow walkthroughs, and a transparent "see exactly what's built" module-by-module page until real customer evidence exists. Flag this as a genuine gap for later phases — see completion report "Remaining inputs." |

## Brand voice

Operational, precise, and calm. Vercentlabs talks like someone who has actually run the shop floor or the books, not like a startup pitch deck. Short declarative sentences over adjective stacks. Specific nouns (work order, requisition, receivable) over vague ones (solution, ecosystem, synergy). Confident about what exists; silent (never hedging or apologetic) about what doesn't — simply don't mention it, per the confident-copy rule already established for this codebase ([[project_landing_design_system]] memory context).

## Message hierarchy

1. **Five-second message** (hero headline + subhead): what Vercentlabs is + who it's for. Must pass the "does a manufacturing/distribution/services operator recognise themselves" test.
2. **Thirty-second explanation** (hero support copy + primary product visual + module strip): the shape of the platform — one system across the operations a growing business runs, illustrated by one concrete cross-module example.
3. **Two-minute product understanding** (homepage body: module architecture, cross-module workflow section, role-based value): enough for a buyer to self-qualify into a module or industry page.
4. **Detailed evaluation content** (module pages, workflow pages, industry pages, security/implementation pages): what a buying committee needs to build a business case.

---

## Hero message candidates

Scored 1–5 on clarity, specificity, relevance, differentiation, credibility, emotional strength, search compatibility, CTA alignment (40 max).

| # | Candidate | Clarity | Specificity | Relevance | Differentiation | Credibility | Emotional | Search | CTA fit | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | "Run your entire business from one connected ERP." | 4 | 1 | 2 | 1 | 3 | 1 | 2 | 2 | 16 |
| 2 | "One system of record for sales, stock, production, and finance." | 4 | 4 | 3 | 3 | 4 | 2 | 3 | 3 | 26 |
| 3 | "Stop reconciling five tools by hand. Run the business on one." | 4 | 3 | 4 | 3 | 3 | 4 | 3 | 3 | 27 |
| 4 | "Every order, every invoice, every stock count — one live number, everywhere." | 4 | 5 | 4 | 4 | 4 | 3 | 2 | 3 | 29 |
| 5 | "The ERP for businesses that outgrew spreadsheets." | 5 | 4 | 5 | 3 | 4 | 4 | 4 | 3 | 32 |

**Selected: Candidate 5, as the headline, paired with Candidate 4's specificity as the immediate subhead.**

Recommended hero pairing:
- **Headline:** "The ERP for businesses that outgrew spreadsheets."
- **Subhead:** "Sales, inventory, procurement, production, and finance — on one live system, from the first order to the balance sheet."

Rationale: Candidate 5 wins on clarity, relevance, and emotional recognition (it names the trigger event from [[icp-and-buyer-map]] directly) and is naturally search-compatible with high-intent "replacing spreadsheets with ERP" queries. Its weakness (differentiation, specificity) is repaired immediately by the subhead, which does the concrete, module-spanning work Candidate 4 scored highest on. This combination is carried forward as the input to [[homepage-blueprint]].
