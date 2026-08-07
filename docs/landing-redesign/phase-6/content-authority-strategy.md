# Content Authority Strategy

The governing strategy for Phase 6 — why these specific pages, in this order, and not a larger or differently-shaped set.

## Search opportunity, not raw page count

The brief was explicit: raw article count is not the goal. Vercentlabs' real, defensible search-authority assets are things a generic ERP content mill can't produce — the actual 1,039-requirement capability model as a public, filterable evaluation tool; real cross-module workflow sequences; real product screenshots; honestly-stated limitations. Every Phase 6 page had to clear a bar of "does this use something only Vercentlabs actually has," not just "is this a topic ERP buyers search for."

## Buyer journey coverage

Phase 6 targets the parts of the ERP buyer journey Phases 1-5 didn't reach:

- **Awareness/education** (glossary): a buyer who doesn't yet know the vocabulary for their problem.
- **Evaluation framework** (buying guide, requirements checklist): a buyer actively comparing vendors, including ones who will never choose Vercentlabs.
- **Implementation planning** (implementation checklist, migration guide): a buyer who has decided to buy *something* and needs to plan the rollout — vendor-neutral by design, so it's useful regardless of which ERP they picked.
- **Direct comparison** (compare/vercentlabs-vs-odoo): a buyer actively choosing between named vendors.
- **Domain depth** (manufacturing ERP guide, ERP vs. spreadsheets): buyers with a specific operational question that a generic "what is ERP" page can't answer.

## Topic clusters prioritized

1. **ERP selection and requirements** (buying guide, requirements checklist, glossary terms like ERP/RBAC/multi-company/multi-tenant) — the highest-commercial-intent cluster, and the one where Vercentlabs' real capability data gives a genuine first-party advantage no competitor content can replicate without the same underlying model.
2. **ERP implementation and migration** (implementation checklist, migration guide) — deliberately vendor-neutral; these pages are allowed to send a reader to a competitor's implementation team and still be a legitimate, honest asset.
3. **Manufacturing/operations depth** (manufacturing ERP guide, BOM/MRP/three-way-match/purchase-requisition glossary terms) — grounded in real, cited product mechanics (one-active-BOM-per-item enforcement, manual MRP triggering stated as a real limitation, structural matching gates).
4. **Comparison** (vercentlabs-vs-odoo) — one comparison, not several, because each one requires live-verified evidence and ongoing maintenance; better to do one well than five thin.

Deliberately NOT prioritized this phase: commodity topics like "Top 10 benefits of ERP" (no defensible first-party angle), a second or third competitor comparison (no research budget to verify and maintain them credibly yet — see `comparison-policy.md`), standalone inventory-management/procurement-process guides (their real substance already lives on the module and workflow pages — a standalone guide would duplicate, not add).

## First-party advantages leaned on

- The real 1,039-requirement, 73-capability-group model (`capability-registry.js`) — powers the requirements checklist directly, no new content invented.
- Real, cited product mechanics already established in `product-intelligence.md` and the module/workflow content — every "how Vercentlabs handles it" glossary section and every resource-guide Vercentlabs-specific claim traces back to this, never a new unverified claim.
- Honest limitations already documented (manual MRP triggering, no automatic GL posting from payroll, standard sales orders not yet deducting stock) — reused as credibility signals in resource content rather than hidden.

## Publishing thresholds

Every page that shipped cleared the 9-point rubric in `.claude/skills/content-authority-audit/` (buyer usefulness, originality, intent differentiation, evidence, product connection, actionability, structure, search technical quality, conversion relevance) — verified in Cycle 2's content-quality-auditor pass, not just asserted. Two candidate guides (inventory-management-guide, procurement-process-guide) were deliberately dropped before drafting because they couldn't clear "intent differentiation" against existing module/workflow pages — see `decision-log.md`'s original scope-decision framing (carried from the approved plan) and `cannibalisation-review.md`.

## Update and retirement process

- **Update**: triggered by `pnpm content:stale` flagging a route past its review interval (see `freshness-and-sitemap-policy.md`), or by a real product change that makes a stated claim or limitation stale.
- **Retirement**: a page gets merged or removed if `pnpm content:cannibalization` or a future manual review finds it's stopped earning its distinct intent — not on a schedule, on evidence.
