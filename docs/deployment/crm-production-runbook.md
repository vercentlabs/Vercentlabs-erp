# CRM production runbook

## Released scope

This release contains the public website, authentication and onboarding,
organisation administration, permissions, master-data foundation, billing
controls, CRM and the native CRM mobile client. Eleven additional ERP modules
are roadmap items and cannot be activated.

## Required production services

- Public landing application.
- Authenticated web application.
- PostgreSQL 16 or a compatible managed PostgreSQL service.
- CRM jobs worker.
- CRM outbox worker.
- Transactional email provider for authentication and invitations.
- Redis-compatible distributed rate limiting for public landing forms.
- HTTPS reverse proxy/load balancer that overwrites the configured client-IP
  header.
- Central logs, error tracking, uptime checks and alerting.
- Encrypted secret management and verified database backups.

The example Compose file is an operational reference, not a substitute for a
managed production design. Kubernetes and Terraform directories remain
platform-specific placeholders until a hosting target is selected.

## Separation of credentials

Use three distinct concerns:

1. **Migration job:** receives `MIGRATION_DATABASE_URL`,
   `APP_DATABASE_ROLE` and `APP_DATABASE_PASSWORD`; exits after migrations and
   role provisioning. It must not serve application traffic.
2. **Web and workers:** receive only restricted `DATABASE_URL`; they must not
   receive the migration-owner URL.
3. **Landing:** receives no database credentials. It uses a signed CRM capture
   destination or a signed generic webhook.

The runtime PostgreSQL role must be `NOSUPERUSER`, `NOBYPASSRLS`, must not own
application tables and must have no schema-creation privilege.

## Pre-deployment gate

Run from the exact release commit:

```bash
pnpm install --frozen-lockfile
pnpm audit:dependencies
pnpm test:all
pnpm verify:release
pnpm lint:landing
pnpm typecheck:landing
pnpm build:landing
pnpm test:landing:e2e
pnpm test:landing:browser
pnpm lint:web
pnpm typecheck:web
pnpm build:web
pnpm lint:mobile
pnpm typecheck:mobile
pnpm verify:mobile
```

Validate environment contracts in an isolated shell without printing secrets:

```bash
NODE_ENV=production node scripts/deployment/validate-production-env.mjs migration
NODE_ENV=production node scripts/deployment/validate-production-env.mjs web
NODE_ENV=production node scripts/deployment/validate-production-env.mjs landing
```

## Database deployment

1. Stop or drain write traffic.
2. Create a custom-format backup with `scripts/database/backup-postgres.sh`.
3. Copy the backup to separate encrypted storage and verify its checksum.
4. Apply control-plane migrations with the owner URL.
5. Apply tenant migrations with the owner URL.
6. Provision/update the restricted runtime role.
7. Remove migration credentials from the job environment.
8. Run control, tenant, CRM and billing database verifiers using the restricted
   runtime URL.
9. Abort before traffic if any verifier fails.

Never edit an applied migration. Add a forward migration. Rehearse restoration
on a separate database before the first public release and after material schema
changes.

## Application deployment order

1. Deploy web and landing images without routing public traffic.
2. Run health and readiness checks internally.
3. Start the CRM jobs and outbox supervisors. Their scripts are one-shot;
   production must invoke them periodically, as shown in the worker example,
   rather than relying on a rapid restart loop.
4. Route a small share of traffic and monitor authentication, query errors,
   queue lag and latency.
5. Run:

```bash
LANDING_URL=https://www.example.com \
WEB_URL=https://app.example.com \
node scripts/deployment/smoke-deployment.mjs
```

To verify the deployed landing-to-CRM/webhook journey as well, use a controlled
recipient that the team can identify and archive:

```bash
LANDING_URL=https://www.example.com \
WEB_URL=https://app.example.com \
SMOKE_LEAD_EMAIL=qa@example.com \
SMOKE_LEAD_COMPANY="Vercentlabs QA" \
node scripts/deployment/smoke-deployment.mjs
```

The live form smoke must return HTTP 202 and the destination must be confirmed
in the CRM or webhook receiver. Do not use a real prospect's email address.

6. Complete both `docs/testing/manual-crm-acceptance.md` and
   `docs/testing/manual-landing-acceptance.md` in staging before full promotion.

## Public lead delivery

- Create the public CRM capture form through the authenticated product.
- Configure its exact HTTPS capture URL on the landing service.
- Store the same random proxy secret of at least 32 characters in both services.
- Configure only a proxy header that the trusted edge overwrites.
- Configure distributed rate limiting; production landing forms fail closed
  without it.
- Rotate the capture form or proxy secret if exposed.

## Workers and communications

- Monitor pending, failed and dead-letter outbox rows.
- Use explicit consent enforcement for outbound communications.
- Treat unsupported channels as unavailable; do not silently mark them sent.
- Configure email delivery and test a controlled recipient before enabling
  automation.
- Run Razorpay reconciliation only after billing operations are enabled and
  supported.

## Billing boundary

Start with checkout disabled and enforcement in observe mode. Enabling live
checkout requires approved pricing, tax/invoice handling, signed webhooks,
replay testing, payment recovery, cancellation/refund procedures, monitoring
and an accountable support owner.

## Rollback

Application rollback means routing traffic to the previous immutable image.
Database rollback is normally a new forward migration. Restore from backup only
for a declared incident after reviewing data-loss impact, stopping writers and
setting the explicit restore confirmation required by
`scripts/database/restore-postgres.sh`.

After any rollback, run all database verifiers and smoke checks before reopening
traffic.

## Go-live approval

Do not open production to real customers until:

- the manual CRM and public website acceptance checklists are complete;
- email, proxy headers, rate limiting and capture delivery are verified;
- restricted-role and cross-tenant tests pass;
- backup restoration has been rehearsed;
- logs, errors, uptime, queue lag and database alerts reach an accountable
  person;
- privacy, terms, security and commercial claims have owner approval;
- an incident contact and rollback decision-maker are available.
