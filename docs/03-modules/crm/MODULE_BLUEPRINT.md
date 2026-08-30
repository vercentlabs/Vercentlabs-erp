# CRM Module Blueprint

- Pass: 1
- Canonical range: F001–F030
- Feature count: 30
- Product boundary: Customer acquisition, relationship management, seller activity, pipeline, forecasting and CRM analytics
- Specification status: `SPECIFICATION_READY`
- Implementation/product readiness: preserved separately; this pass does not certify product code.

## Pass exit result
Research, capability mapping, all 30 dossier decompositions, data/state/API/security/integration contracts, desktop/tablet/mobile/accessibility behavior, current-code evidence, automated/E2E/UAT plans, visual workspace contract and omission review are documented and validator-backed.

## Architecture rule
F-IDs remain durable traceability anchors. Implementation converges on coherent CRM capabilities and public commands/queries rather than one service/folder per F-ID. Cross-module workflows use orchestration/public module contracts.

## Authoritative capability groups
See `capabilities/MODULE_CAPABILITY_PACK.md`.

## Critical CRM journeys
1. Prospect capture → duplicate/data-quality → assignment → qualification → conversion.
2. Opportunity → pipeline/stage/probability → won/lost outcome.
3. Opportunity → Sales quotation handoff (CRM F023 → Sales F036 public contract).
4. Seller daily work → calls/meetings/tasks/follow-up/email/timeline.
5. Pipeline → dashboard/reporting → forecast submission/snapshot/adjustment.
