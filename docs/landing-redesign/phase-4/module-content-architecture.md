# Module Content Architecture

Single source of truth: `packages/landing-content/src/modules.js` — every module page renders exclusively from this file (plus `capability-registry.js` for traceability), no page-specific copy hardcoded in `apps/landing/app/modules/[slug]/page.tsx` itself.

## The `LandingModule` shape

Every one of the 12 modules carries the same typed fields (`packages/landing-content/src/index.d.ts`), each required and validated by `packages/landing-content/tests/module-content.test.mjs`:

| Field | Purpose | Test coverage |
|---|---|---|
| `directDefinition` | The "what is the Vercentlabs {module} module?" answer, server-rendered near the top of the page | Non-empty, unique across all 12, mentions the module or product |
| `heroVariant` | One of 4 controlled hero layouts (`screenshot-led`, `dashboard-led`, `workflow-led`, `operational-sequence`) | Must be one of the 4 allowed values |
| `searchIntent` / `metaDescription` | SEO ownership per page | Unique across all 12 |
| `businessProblems` (3-4 items) | Module-specific pain points — never the homepage's generic "disconnected tools" framing | Non-empty per module |
| `businessOutcomes` (4-5 items) | Credible, non-quantified outcomes | Non-empty per module |
| `capabilityGroups` (5-7 items) | The module's real feature architecture — `{ id, name, description, capabilities[], requirementCount, workflowSlug? }` | Every module has ≥5 groups; every group has capabilities and a positive requirement count |
| `primaryWorkflow` | One end-to-end workflow this module is central to — `{ name, trigger, steps[], approvals[], automatedActions[], connectedModuleKeys[], outcome }` | ≥3 steps, a real outcome, at least one approval or automated action |
| `connectedModules` | `{ moduleKey, relationship }[]` — meaningful, specific relationship text, never "integrates with everything" | Every `moduleKey` resolves to a real module; relationship text is substantive (>15 chars) |
| `reporting` / `automation` / `governance` | Module-specific operational detail | Non-empty per module |
| `implementationConsiderations` (≥3 items) | Honest rollout planning content | Non-empty per module |
| `faqs` (≥2 items) | Module-specific buyer questions | No duplicate questions across modules |
| `screenshots` | `{ primary?, secondary? }` — screenshot IDs, resolved against `apps/landing/lib/product/screenshots.ts`'s approval list at render time | N/A — resolution happens at render, not content-authoring, time |
| `conversion` | `{ heading, ctaLabel }` — module-specific final-CTA framing | Unique heading across all 12 |

## Where the content came from

Every field traces directly to `docs/landing-redesign/phase-1/product-intelligence.md`'s per-module profile (Purpose, Personas, Problems solved, Capability groups, Cross-module, Automations, Reports, Mobile, Security, Best marketing angle) — this phase's work was to *structure and present* that already-vetted, code-cited research into the typed schema and real pages, not to re-research the product. See `decision-log.md` item 2 for why this materially changed the effort shape versus doing fresh independent research per module.

## Hero variant assignment

| Module | Variant | Screenshot evidence | Why |
|---|---|---|---|
| CRM | `screenshot-led` | `crm-pipeline-board` + `crm-leads-list` | Real, dedicated evidence — features it directly in the hero |
| Stock | `dashboard-led` | `stock-overview` | Real, dedicated evidence |
| Accounting | `dashboard-led` | `sales-order-detail` (borrowed/secondary) | The one module with only borrowed evidence, not a dedicated capture — flagged honestly rather than presented as accounting-specific |
| Sales | `workflow-led` | `sales-quotation-detail` + `sales-order-detail` | Has real evidence, but the quote-to-order sequence is strong enough to lead with the workflow strip; the screenshots still appear in the page's dedicated evidence section below |
| Procurement, Projects, Quality, Support | `workflow-led` | None | Clear, linear primary workflow (requisition-to-order; plan-to-delivery; inspection-to-CAPA; ticket-to-resolution) suits a horizontal strip even without a screenshot |
| Manufacturing, Assets, HR & Payroll | `operational-sequence` | None | Multi-stage lifecycle (demand-to-production; acquisition-to-disposal; attendance-to-payroll) suits a vertical numbered sequence |

**Corrected during this phase's Cycle 2 review prep**: `point-of-sale`, `support`, and `hr-payroll` were initially content-assigned `screenshot-led`/`dashboard-led` despite having zero approved screenshots — `ModuleHero`'s runtime fallback (see below) would have silently rendered them as `operational-sequence` anyway, so nothing was ever visually broken, but the *content* itself was internally inconsistent with the evidence it actually had. Reassigned directly to `workflow-led` (support) and `operational-sequence` (point-of-sale, hr-payroll) so the content accurately reflects what renders, rather than relying on the fallback to paper over a content-authoring mistake. See `decision-log.md`.

`ModuleHero` (`apps/landing/components/modules/module-hero.tsx`) still enforces the fallback defensively at render time regardless of what's assigned in content: if a module's variant wants a screenshot (`screenshot-led`/`dashboard-led`) but none is actually approved, it falls back to `operational-sequence` rather than rendering an empty slot — the same defensive pattern Phase 3 established for the homepage hero after finding that exact defect. This is now a safety net, not the mechanism doing real work for any of the 12 modules as shipped.

## Capability groups vs. the traceability registry

`modules.js`'s `capabilityGroups` is the single source of truth; `capability-registry.js` derives its module-specific entries directly from it (not a second hand-maintained copy) — see `capability-traceability.md` for the full methodology and why this avoids the two sources ever disagreeing.
