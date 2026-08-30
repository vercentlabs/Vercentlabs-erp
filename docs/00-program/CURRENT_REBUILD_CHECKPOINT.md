# Current Rebuild Checkpoint

## Completed
- Documentation governance/bootstrap created.
- Exact canonical F001–F510 dossiers created.
- Documentation framework audit completed.
- Machine-checkable dossier schema v2.0.0 frozen.
- Canonical fingerprint enforcement enabled.
- Benchmark evidence register hardened for feature/capability traceability.
- Specification lifecycle and deterministic validator added.

## Current state
All 510 dossiers remain intentionally `UNSPECIFIED`. The audit hardening changes structure and governance only; it does not fabricate research, requirements, capabilities, dependencies or implementation evidence.

## Mandatory validator
Run before and after every documentation pass:

```bash
bash docs/scripts/validate_blueprint.sh
```

## Next pass
**Pass 1 — CRM F001–F030 — specification only.**

Required outputs: current-code CRM audit, official benchmark evidence, CRM capability architecture, nested requirements, F001–F030 enterprise dossiers, CRM dependency/integration contracts, Lead-to-Cash handoff detail, test/UAT specifications, omission/red-team review, synchronized registers and evidence for any `SPECIFICATION_READY` promotion.
