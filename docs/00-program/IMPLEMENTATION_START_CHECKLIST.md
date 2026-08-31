# Implementation Start Checklist

Before beginning any capability/wave:
1. Confirm `python docs/scripts/validate_pm_planning.py` passes.
2. Confirm `python docs/scripts/check_planning_closure.py` returns PASS.
3. Confirm `python docs/scripts/check_implementation_authorization.py` returns PASS.
4. Load F/SP authority, semantic sub-capabilities, flow/state contracts, benchmark decisions, architecture placement, journey dependencies and planned verification IDs.
5. Audit the current repository and reuse existing schema/services/routes/components/tests.
6. Create a capability implementation manifest before edits.
7. Implement database invariants/RLS/concurrency first, then domain commands/queries, transport, web/mobile and orchestration.
8. Add tests for every planned verification obligation touched by the capability.
9. Run security/tenant/adversarial checks and the repository verification chain.
10. Produce implementation evidence; never promote product readiness from code existence.
11. Update RAID/checkpoint/cost/evidence records before opening a successor wave when project truth changed.

Initial authorized dependency sequence: `T00 → T01 → W01 → … → W15`, constrained by the canonical predecessor register. Human WIP limit is one wave.

No start date, finish date, deadline, duration, effort-hour estimate or delivery forecast is implied by this checklist.
