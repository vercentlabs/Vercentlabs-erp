# Current Rebuild Checkpoint

## Completed
- Documentation bootstrap and audit hardening completed.
- Exact canonical F001–F510 fingerprint enforced.
- Feature Dossier schema upgraded to v3.0.0.
- Separate working-status and readiness-gate axes installed.
- Expanded nested requirement taxonomy installed.
- Evidence, decision, capability, dependency, benchmark, journey and readiness control-plane registers installed.
- Official research source library seeded without fabricating benchmark findings.
- Reference, benchmark and readiness validators installed.

## Critical truth
All 510 canonical feature dossiers remain intentionally `UNSPECIFIED` / `NONE`. The v3 migration implements the research and governance system; it does **not** pretend that every advanced subfeature has already been researched and approved.

## Mandatory validation
```bash
bash docs/scripts/validate_blueprint.sh
```

## Next task
**Pass 1 / 12 — CRM F001–F030 — evidence-backed specification only.**

Pass 1 must populate actual researched subfeatures, benchmark evidence, capability contracts, current-code evidence, requirements, flows, UX/data/security/API/integration design, tests/E2E/UAT and red-team omission review before any CRM dossier can reach `SPECIFICATION_READY`.
