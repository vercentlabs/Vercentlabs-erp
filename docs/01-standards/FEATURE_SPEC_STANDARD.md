# Feature Specification Standard

## Purpose
This file is the normative contract for all canonical F001–F510 dossiers. The canonical feature IDs and names never change here. Deeper requirements are nested under their parent F-ID and must never become F511+.

## Machine-enforced schema
The exact required section identifiers and order are defined in `FEATURE_DOSSIER_SCHEMA.json`. Each dossier heading begins with a stable identifier such as `SPEC-SECURITY` or `SPEC-UAT`; validators check these identifiers rather than fuzzy prose.

## Nested traceability IDs
Use `{F-ID}-{TYPE}-{NNN}`. Allowed types are `FR`, `BR`, `DATA`, `UX`, `SEC`, `INT`, `AI`, `OBS`, `E2E`, and `UAT`. Example: `F001-SEC-004`. These IDs are requirements under a canonical feature, not new canonical features.

## Evidence rule
A section is not complete because prose exists. Material requirements must be traceable to one or more of: product-owner decision, official benchmark evidence, domain invariant, current-code evidence, security/control requirement, integration contract, automated test, or UAT evidence.

## Omission rule
The canonical feature name is a traceability anchor, not the maximum product scope. Each dossier must explicitly evaluate enterprise-expected behavior and classify researched benchmark capabilities as `REQUIRED`, `DIFFERENTIATOR`, or `NOT_APPLICABLE` with rationale.

## Status rule
Feature dossier status follows `SPECIFICATION_LIFECYCLE.md`. `SPECIFICATION_READY` requires objective evidence for every applicable dossier section, synchronized registers, parent capability coherence, and applicable critical-journey contracts.
