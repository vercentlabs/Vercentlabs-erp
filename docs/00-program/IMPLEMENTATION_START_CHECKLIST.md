# Implementation Start Checklist

Before beginning any capability/wave:
1. Confirm `check_implementation_authorization.py` returns PASS.
2. Load F/SP authority, semantic sub-capabilities, flow/state contracts, benchmark decisions, architecture placement, journey dependencies and planned verification IDs.
3. Audit the current repository and reuse existing schema/services/routes/components/tests.
4. Create a capability implementation manifest before edits.
5. Implement database invariants/RLS/concurrency first, then domain commands/queries, transport, web/mobile and orchestration.
6. Add tests for every planned verification obligation touched by the capability.
7. Run security/tenant/adversarial checks and the repository verification chain.
8. Produce implementation evidence; never promote product readiness from code existence.

Initial authorized sequence: `T00 → T01 → W01/W02 → dependency-aware module waves`.
