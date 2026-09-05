# F027 Basic lead scoring — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `evaluateLeadScoreRule`, `calculateLeadScoreBreakdown`, and `recalculateLeadScore` in `lead-intelligence.js` in full.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | `getLeadScoreExplanation` plus the `score_explanation`/`contributions` data give a full per-rule breakdown, not just a bare number. |
| CAP-002 (multiple models, **decay**, **caps**, segmentation, **versioning**, **recalculation determinism**, explanation, separation from qualification/probability) | **PASS on every sub-item — the strongest, cleanest result of the entire CRM audit.** Decay: `evaluateLeadScoreRule` applies real exponential half-life decay to behavioral-event contributions (`Math.pow(0.5, ageDays / halfLifeDays)`, `:160`) — mathematically correct, not a crude linear taper. Caps: `calculateLeadScoreBreakdown` clamps the final score between a configurable `score_floor`/`score_ceiling` (`:178-179, 201`). Multiple models + versioning: scoring rules are scoped to a `model_id` looked up via `activeModel()`, and `model.version` is captured directly into the persisted explanation (`recalculateLeadScore:487`) — so a later model change doesn't retroactively alter what a past score's explanation claims it was based on (this is exactly the "label versioning" protection that F026 was found to be *missing* for lost reasons — a good pattern to backport there). **Recalculation determinism: PASS, and worth calling out specifically** — `calculateLeadScoreBreakdown` is a pure function: given the same `lead`, `model`, `rules`, `events`, and `now`, it always produces the same score, with no hidden mutable state or randomness. This is the cleanest, most testable piece of business logic found in this entire audit. Explanation: PASS — `contributions` itemizes every rule's name, signal type, points, and occurrence count. Separation from qualification/probability: PASS — confirmed directly, this function never reads or writes `qualification_state` or opportunity probability. |
| CAP-003 (scoring informs but doesn't silently decide assignment/qualification) | PASS | `recalculateLeadScore` only updates `crm_leads.score`/`lead_grade`/`score_explanation` — it never calls `decideLeadQualification` or `resolveLeadAssignment` itself; those remain separately, explicitly invoked (F006/F005 audits) rather than triggered as a side effect of scoring. |
| FR-001/002/003 | PASS | full workflow; `crm_lead_behavior_events` query is time-bounded (5 years) rather than unbounded, a sensible enterprise-volume guard. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | `getScopedLead(..., lock: true)` before recalculation prevents a concurrent recalculation race; `assertSensitiveLeadIntelligenceAccess` gates the whole operation. |
| BR-001/BR-002 | PASS | single recalculation path; `score_explanation` is a content-hashed snapshot (`crmLeadIntelligenceHash`), not a value that could be silently altered without detection. |
| DATA-001/002 | PASS | `crm_lead_scoring_model_rules`, `crm_lead_behavior_events`, `crm_lead_score_snapshots` (confirmed earlier in F001's audit) all exist and relate correctly, with the model-version pinning noted above. |
| VAL-001/002 | N/A (mostly) | this is a computed feature, not a user-input form; the one input (recalculation trigger) has no meaningful validation surface beyond permission/scope. |
| CALC-001 | PASS | see determinism finding above — this is the calculation-quality bar the rest of the codebase should be measured against. |
| UX-001/002/003 | PASS (by test evidence) | covered under the same lead-workspace tests already confirmed passing (score display/explanation is part of the lead detail surface verified in F001's audit). |
| SEC-001/002 | PASS | `assertSensitiveLeadIntelligenceAccess` is a dedicated, named gate distinct from general CRM view — appropriately stricter given scoring reveals behavioral profiling data. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass — though given this is explicitly "scoring," a follow-up on whether it's classified/governed as an AI system (vs. a deterministic rules engine, which is what it actually is) would be worth confirming against the dossier's AI-authority framework. |
| API-001/002 | PASS | route pattern consistent with the rest of the module. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

29 of 37 rows PASS, tied with F011 for the strongest result in the CRM audit, and arguably the cleanest: every single CAP-002 sub-item is met with cited, specific evidence, and the core calculation function is a genuinely exemplary pure/deterministic design. If the gap-closing pass needs one feature to point to as "build it like this," it's this one.
