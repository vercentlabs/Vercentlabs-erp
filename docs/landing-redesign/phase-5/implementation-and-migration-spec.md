# Implementation and Migration Spec

## Route decision

`/implementation` is a single page covering all 8 phases; data migration is the expanded section of the "Data Migration" phase (`migrationChecklist`), not a separate `/implementation/migration` route. The approved Phase 1 IA doc lists no dedicated migration route under Tier 4, and the governing prompt for this phase explicitly allowed either approach — see `decision-log.md` item 4.

## The 8 phases

`packages/landing-content/src/implementation.js`'s `IMPLEMENTATION_PAGE.phases`, in order: Discovery, Solution Design, Configuration, Data Migration, Testing, Training, Launch, Post-Launch. Each carries `description`, `activities[]`, `typicalOutputs[]`; Data Migration additionally carries `migrationChecklist[]` (item master, customer/supplier master data, opening stock balances, open transactions, chart of accounts/opening trial balance).

## Evidence grounding

- **Discovery/Solution Design/Configuration**: grounded in the Shared Platform's real, cited tenant-onboarding mechanics (`Tenant Onboarding & Module Entitlement` cross-module workflow — organisation bootstrap seeds ~12 roles and ~29 numbering series in one transaction) and `icp-and-buyer-map.md`'s real evaluation criteria ("Can it handle their actual BOM complexity," "is data isolated correctly if multi-company").
- **Data Migration**: `product-evidence-register.md`'s existing line — "Customers, items, suppliers, and open transactions are migrated and reconciled as part of implementation" — explicitly marked there as "a service commitment, not a specific code-evidence claim." This phase's migration checklist stays within that same honest framing; it does not claim an automated one-click import tool exists.
- **Launch**: cites the real, cited billing pipeline (HMAC-verified, replay-protected Razorpay webhook, advisory-lock-serialized) and module entitlement gating.

## No fabricated timeframes

CLAUDE.md's Evidence and Honesty Rules explicitly forbid fabricating "migration times." No phase names a specific day/week/month duration or completion-rate guarantee anywhere — `implementation-content.test.mjs`'s "no phase claims a specific duration" test enforces this with a regex scan (`/\b\d+\s*(day|week|month|hour)s?\b/i`) against every phase's full JSON content, not just a spot check. The FAQ addressing "how long does implementation take?" answers honestly that duration varies by scope rather than inventing a number.

## Structured data

`WebPage` + `FAQPage` (4 real FAQs), referencing the single `SoftwareApplication` via `SOFTWARE_APPLICATION_ID` — same pattern as every other Phase 5 page. No `HowTo` schema (see `workflow-content-architecture.md`'s reasoning, which applies equally here — this describes a service methodology, not a self-service tutorial).
