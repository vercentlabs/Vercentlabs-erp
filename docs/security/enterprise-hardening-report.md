# Enterprise hardening report

This change set closes the highest-risk security and reliability defects found in the July 2026 repository audit. It is a forward-only hardening release and does not claim that the planned ERP module roadmap is fully implemented.

## Implemented controls

- Session context revalidates active organisation, company and branch access and repairs stale preferences.
- Access and role changes revoke affected sessions.
- Multi-organisation sessions bind an explicit active organisation and expose a guarded switch route.
- Invitations store explicit company, branch and department scope and default to least privilege.
- Invitation acceptance is rate limited, replay resistant, and cannot reactivate disabled global accounts or overwrite an existing profile.
- Login uses dummy password verification and generic public failures.
- Cookie-authenticated mutations require a trusted same-origin signal.
- Client address resolution trusts only an explicitly configured proxy header.
- Razorpay webhooks use bounded raw-body reads, event-age checks, payload hashes and duplicate-content detection.
- Tenant relationships receive organisation-aware composite constraints in a forward migration.
- Runtime database-role provisioning enforces `NOSUPERUSER`, `NOBYPASSRLS` and non-ownership.
- Migration runners use advisory locks, checksums and atomic ledger recording for transactional migrations.
- CRM saved views are user-owned, generic archive fallbacks are removed, and unsupported approval execution fails closed.
- CRM automation uses savepoints and the CRM outbox has a retrying, dead-letter-capable delivery worker.
- CSV import supports quoted multiline records; CSV export neutralises spreadsheet formulas.
- Business-data `PATCH` changes only supplied fields.
- Liveness and readiness are separated, and sensitive API responses are non-cacheable.
- Public marketing now labels unimplemented operational modules as roadmap or design-partner scope.

## Validation performed on the reconstructed audited commit

- Web ESLint: passed.
- Web TypeScript: passed.
- Landing ESLint: passed.
- Landing TypeScript: passed.
- Web tests: 33 passed.
- API tests: 18 passed.
- Shared SDK tests: 5 passed.
- New control-plane and tenant SQL migrations: PostgreSQL parser validation passed.

## Deployment requirements

1. Back up and test restoration before migration.
2. Configure a separate `MIGRATION_DATABASE_URL`.
3. Provision a restricted runtime role with `pnpm db:provision:runtime-role`.
4. Set `DATABASE_URL` to the restricted runtime role.
5. Apply control-plane and tenant migrations through the migration commands.
6. Configure trusted-proxy and webhook limits from `.env.example`.
7. Run the CRM outbox worker under a process supervisor.
8. Verify `/api/readiness` before directing production traffic.

## Deliberate fail-closed limitations

- Approval decisions are disabled until a domain-command approval engine is implemented. The UI no longer claims that status updates execute business actions.
- Provider-bound CRM delivery remains blocked when provider credentials or supported consent evidence are absent.
- This hardening release does not create the planned finance, procurement, inventory, manufacturing, payroll or other full ERP modules.
