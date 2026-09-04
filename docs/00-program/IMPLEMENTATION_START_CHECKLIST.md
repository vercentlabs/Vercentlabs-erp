# Implementation Start Checklist

No new AI implementation work begins from an informal “wave” assignment. Every implementation assignment starts from a registered Agent Work Package.

## Step 0 — Acquire registered work package

Before edits, the agent must:

1. know its `AWP-ID` and load the exact row from `AGENT_WORK_PACKAGE_REGISTER.csv`;
2. verify the canonical wave and canonical predecessor evidence;
3. verify package-level dependencies;
4. verify the registered base commit and branch/worktree;
5. verify exact owned/forbidden paths;
6. verify migration reservations where required;
7. verify shared-change restrictions;
8. run the parallel-governance validator and per-agent scope validator.

During the governance rollout, **no new package may start until those validators exist and the live execution state has been reconciled**.

## Capability implementation checklist

1. Confirm PM planning, planning closure and implementation authorization validators pass.
2. Load F/SP authority, semantic sub-capabilities, flow/state contracts, benchmark decisions, architecture placement, journey dependencies and planned verification IDs.
3. Audit the current repository and reuse existing schema/services/routes/components/tests.
4. Emit the package implementation manifest before edits.
5. Implement database invariants/RLS/concurrency first, then domain commands/queries, transport, web/mobile and orchestration.
6. Add tests for every planned verification obligation touched by the package.
7. Run security/tenant/adversarial checks and the package/repository verification chain.
8. Produce package-specific evidence; never promote product readiness from code existence.
9. Mark `READY_FOR_INTEGRATION`, stop edits, and pass scope validation.
10. Let PM/integration serialize integration, rerun gates against current main, record evidence and update central registers.

`pm_integration_wip_limit=1`; dependency-safe AI execution may be concurrent. No start date, finish date, deadline, duration, effort-hour estimate or delivery forecast is implied.
