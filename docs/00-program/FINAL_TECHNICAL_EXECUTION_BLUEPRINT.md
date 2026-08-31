# Final Technical & AI Execution Blueprint

Status: `ARCHITECTURE_FROZEN_PASS_E`

## Purpose
Bind the 510 business-feature specifications and separate shared-platform baseline to one deterministic implementation method so an AI engineering agent does not make architecture decisions ad hoc while coding.

## Planning hierarchy
0. Product vision/scope  
1. 510 canonical business F-IDs + separately governed 36 shared-platform requirements  
2. Capability packs/dependencies  
3. Feature sub-capabilities  
4. Atomic requirements  
5. User flows/state machines  
6. Data model/invariants  
7. Commands/queries/events/jobs  
8. API contracts  
9. Web UX  
10. Mobile/offline UX  
11. Cross-module orchestration  
12. Security/authorization  
13. Tests/UAT  
14. Observability/performance/DR  
15. Migration/rollout/rollback  
16. AI implementation instructions  
17. Dependency-aware implementation waves  
18. Production certification.

## Architecture baseline
- Modular monolith; public module contracts; orchestration for cross-module workflows.
- PostgreSQL is the authoritative transactional store; RLS is defense-in-depth alongside server authorization.
- Web/mobile never become independent business-rule engines.
- Deterministic authority remains for finance, inventory/valuation, payroll/statutory calculations, payments, authorization and legal state transitions.
- Durable async work uses outbox/jobs with stable idempotency, retry/dead-letter and reconciliation.
- UX is governed by the Experience Kernel and WCAG 2.2 AA intent.
- AI product features are authorization-safe assistants; AI engineering follows `AI_ENGINEERING_EXECUTION_PROTOCOL.md`.

## Implementation authorization
This blueprint being present does **not** itself authorize mass implementation. Run `python docs/scripts/check_implementation_authorization.py`. Authorization requires the exact 36 shared-platform authority plus independent semantic and benchmark relevance approval and all architecture-freeze blockers cleared.
