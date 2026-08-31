# Implementation Authorization Standard

Status: `FROZEN_PASS_F`

Implementation authorization is a **planning gate**, not product readiness. It allows dependency-aware implementation only when canonical F001-F510, SP001-SP036, semantic scope, flow/state contracts, benchmark relevance, architecture/AI execution rules, end-to-end journey planning and requirement-to-verification traceability are complete.

A feature may be implemented only inside its approved capability/wave with prerequisite dependencies satisfied. Every change follows the AI engineering protocol: authority load → repo audit → implementation manifest → DB/invariants → domain backend → thin API → web/mobile → public-contract integration → automated verification → adversarial review → repository gates → evidence.

No implementation may mark a feature/product ready merely because files, routes, tables or tests exist. Product readiness still requires actual implementation evidence, cross-module E2E, UAT, migration/restore/release evidence and production certification.
