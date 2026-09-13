# ADR-0004: Registers and documentation cannot self-certify implementation status

## Status

Accepted.

## Context

`product/registers/shared-platform.yaml` tracks `specificationStatus`,
`implementationStatus` and `productStatus` for all 36 shared-platform
capabilities. It would be easy - and wrong - for a future change to simply
edit `implementationStatus: NOT_STARTED` to `IMPLEMENTED` in that YAML file,
or for a README/design doc to describe a capability as done, without any
corresponding code, migration, or passing test proving it. Root governance
rules 1-3 and 15 exist precisely to prevent that failure mode.

## Decision

1. The register is generated/maintained content, not proof. It is a claim,
   and claims require evidence.
2. `implementationStatus` may only move to `IMPLEMENTED` when a
   corresponding file exists under `product/evidence/` for that SP id,
   containing: what was built, the commands actually executed, exact
   pass/fail totals, and which services were actually started (matching the
   format of `product/evidence/PROMPT-001-FOUNDATION.md`).
3. `tests/architecture/register-integrity.test.ts` enforces this
   mechanically: any capability marked `IMPLEMENTED` with an empty
   `evidencePaths` array fails validation, and `pnpm register:validate`
   (part of `pnpm verify`) fails the same way.
4. A screen existing in `apps/web`, a route existing in `apps/api`, or a
   paragraph of documentation describing a capability are each, on their
   own, insufficient evidence (root governance rules 2-3). Evidence must
   point to live code, a reviewed migration, and a test or command that
   actually exercised it.
5. This prompt (Prompt 1) is itself an example: it builds substantial
   engineering foundation but changes zero SP statuses.
   `product/evidence/PROMPT-001-FOUNDATION.md` documents the foundation
   work and explicitly confirms all 36 capabilities remain `NOT_STARTED`.

## Consequences

- Marking something done takes more than editing YAML or writing a doc -
  by design.
- `product/acceptance/` will hold the acceptance criteria each evidence file
  must satisfy, so "evidence" has a fixed bar rather than being whatever a
  given change happens to produce.
- Anyone (human or AI) reviewing this repo can trust
  `implementationStatus: IMPLEMENTED` because it is mechanically checked
  against the presence of an evidence file, not merely asserted.
