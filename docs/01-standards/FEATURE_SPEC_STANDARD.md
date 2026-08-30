# Feature Dossier Standard — v3

The canonical register contains exactly F001–F510. An F-ID is a permanent traceability anchor, not the maximum product scope and not a code-folder instruction. Enterprise behavior discovered underneath a feature is represented by nested IDs such as `F001-FR-001`, never F511+.

## Normative language
Use **MUST / MUST NOT / SHOULD / MAY** for requirements. Every material requirement receives a stable nested ID and is mirrored into `SUBREQUIREMENT_REGISTER.csv`.

## Requirement types
`CAP`, `FR`, `US`, `FLOW`, `BR`, `DATA`, `VAL`, `CALC`, `UX`, `SEC`, `AUTO`, `APP`, `NOTIF`, `REP`, `AI`, `INT`, `API`, `PERF`, `OBS`, `E2E`, `UAT`.

## Evidence rule
Prose alone is never evidence. Requirements must trace to one or more of: official benchmark evidence, deliberate product decision, domain invariant, current-code evidence, standard/security control, integration contract, automated verification or human UAT.

## Omission rule
Every module pass must actively search for capabilities hidden behind short canonical names. Every material benchmark finding must be dispositioned as `REQUIRED`, `DIFFERENTIATOR`, or `NOT_APPLICABLE` with rationale. Silence is not a valid decision.

## Readiness rule
`SPECIFICATION_READY` requires complete research, decomposed requirements, UX/domain/security/API/integration design, red-team omission review, test/E2E/UAT design, synchronized registers and applicable parent capability/journey contracts.

## Requirement-contract completeness gate
Every canonical dossier MUST carry either a placeholder (`Fxxx-TYPE-###`) or at least one materialized ID (`Fxxx-TYPE-001`) for every requirement type declared by `FEATURE_DOSSIER_SCHEMA.json`. Placeholder presence is a framework-integrity check only; it is **not** evidence that the requirement has been researched or approved. During a module pass, placeholders are replaced by substantive traceable requirements and synchronized into `SUBREQUIREMENT_REGISTER.csv`.
