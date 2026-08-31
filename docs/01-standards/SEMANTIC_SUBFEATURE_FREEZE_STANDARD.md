# Semantic & Sub-feature Freeze Standard

Final Pass B exists to prevent short canonical feature names from becoming shallow CRUD implementations.

## Authority
- F001-F510 remain the canonical business-feature identities.
- SP001-SP036 remain separate shared-platform identities.
- Pass B may expand a canonical feature into mandatory semantic sub-capabilities, but it may not invent canonical feature IDs above F510.

## Classification
Every suspected omission is classified as:
- **A_MISSING_MANDATORY_FEATURE** — genuinely unowned business capability; architecture freeze blocked and founder change control required.
- **B_EXISTING_FID_SUBCAPABILITY** — mature behavior owned by an existing F-ID; expand the dossier, do not add a feature.
- **C_CROSS_MODULE_JOURNEY** — behavior owned by a journey/contract across modules.
- **D_SHARED_PLATFORM** — cross-cutting platform requirement owned by SP001-SP036.
- **E_OPTIONAL_ADVANCED** — useful advanced/vertical scope, not mandatory baseline ERP.

## Required semantic axes
Every canonical feature must explicitly own lifecycle/core outcome, data/historical truth, deterministic rules, security/scope, operator UX, integration/authority boundaries, exception/concurrency/recovery, and verification/audit.

## Approval gate
A feature is `APPROVED` for Pass B only when all eight semantic axes are frozen, no class-A omission remains, shared/cross-module ownership is explicit, and the canonical identity is unchanged. Pass B approval is planning evidence only; it does not promote implementation or product readiness.
