# Production architecture — Google Cloud

The concise reference for how Vercentlabs ERP runs in production. Procedures
live in the runbooks; this document explains the shape and the trust
boundaries they rely on.

- Operating the system: [PRODUCTION_RUNBOOK.md](../operations/PRODUCTION_RUNBOOK.md)
- Releasing and migrations: [RELEASE_RUNBOOK.md](../operations/RELEASE_RUNBOOK.md)
- Backups, restore, RPO/RTO: [DISASTER_RECOVERY_RUNBOOK.md](../operations/DISASTER_RECOVERY_RUNBOOK.md)
- Provisioning: [infrastructure/terraform/README.md](../../infrastructure/terraform/README.md)
- Application trust boundaries and access: [SHARED_PLATFORM_ARCHITECTURE.md](SHARED_PLATFORM_ARCHITECTURE.md)

Status: the Terraform, manifests and workflows are validated statically in CI
(`terraform validate`, render + schema checks, image builds and scans,
`pnpm verify:production`, a production-configuration smoke with local
stand-ins). They have **not yet been applied to a real Google Cloud project**.

## 1. Topology

```text
Hostinger DNS (A/AAAA records only; the domain stays at Hostinger)
     ↓
Google external HTTPS Load Balancer  (managed TLS certificates, SSL policy, HTTP→HTTPS)
     ↓
Cloud Armor  (security policy on every backend)
     ↓
GKE Autopilot, regional, asia-south1, private nodes
 ├── Landing   (public marketing site)
 ├── Web/API   (Next.js ERP + /api, Cloud SQL Auth Proxy sidecar)
 └── Worker    (background jobs, Cloud SQL Auth Proxy sidecar)
      │
      ├── Cloud SQL PostgreSQL 16  (private IP only; REGIONAL HA in production)
      ├── Cloud Storage            (private attachment/document bucket)
      ├── Secret Manager           (mounted with the Secret Manager CSI driver)
      ├── Cloud KMS                (envelope encryption of stored integration secrets)
      └── Cloud Logging / Monitoring / Error Reporting

Images  → Artifact Registry (immutable tags, deployed by digest)
GitHub  → Workload Identity Federation → Google Cloud (no service-account keys)
```

Everything runs in one project per environment (staging, production) in
`asia-south1`. There is no AWS, Azure, Redis or Kafka dependency; background
work uses the PostgreSQL job queue.

## 2. Trust boundaries

| Boundary | Enforced by |
| --- | --- |
| Internet → load balancer | Managed TLS only (HTTP redirects), Cloud Armor policy, the SSL policy. Only the Ingress is public. |
| Load balancer → pods | GKE NetworkPolicy: web and landing accept traffic only from the load balancer and health checks; the worker accepts none except its probes. Egress is limited to what each workload needs. |
| Pod → Google APIs | Workload Identity: each Kubernetes service account maps to its own Google service account with only its own permissions. No key files exist. |
| Pod → database | Cloud SQL Auth Proxy (IAM-authorised, encrypted) to a private-IP instance; a separate restricted PostgreSQL role per workload (§3). |
| Request → organisation data | The application resolves the organisation from the session or API key, never from the request body; PostgreSQL RLS enforces it again (§3). |
| GitHub → Google Cloud | OIDC Workload Identity Federation, restricted to `refs/heads/main` and the matching GitHub environment; production needs environment approval. Pull requests receive no cloud credentials. |

Pods run as non-root (UID 10001) with a read-only root filesystem, all
capabilities dropped and the `restricted` Pod Security Standard on the
namespace.

## 3. Database identities and RLS

Three PostgreSQL authorities, each with its own connection string in Secret
Manager:

| Authority | Production role | Used by | Rights |
| --- | --- | --- | --- |
| Migration | `vercent_migrator` | the migration Job only | owns the schema; runs expand migrations; provisions the two runtime roles |
| Web | `vercent_web` | web/API pods | `LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`, no role memberships, owns nothing, exactly the privileges of the table classification |
| Worker | `vercent_worker` | worker pods | as web, with the worker's own classification column |

CI and local development use equivalent **test** names: the migration owner
is the container's `vercentlabs` user, the runtime roles `vercent_web` and
`vercent_worker` (older local databases may still use `vercent_app` as the web
role; that keeps working). Runtime roles are created and re-derived by
`pnpm db:provision:runtime-role` after every migration — never by hand.

Two immutable historical tenant migrations grant to the legacy role name
`vercent_app`. On a fresh cluster, `db:migrate` creates it first as a
powerless NOLOGIN compatibility role, and provisioning removes it afterwards
unless it is the configured web role
(`scripts/database/historical-roles.mjs`; proved by
`tests/integration/production/fresh-database-db.test.mjs`).

Row-level security: every organisation-scoped table (tenant schema and
classified public tables) has `ENABLE` + `FORCE ROW LEVEL SECURITY` and the
canonical policy on `current_organization_id()`, set per transaction by the
application. The web and worker roles cannot bypass it. The web refuses to
start if its role is not restricted, and readiness fails if it is.

## 4. Secrets and encryption

- Connection strings, SMTP/OAuth/Razorpay credentials and webhook secrets are
  Secret Manager secrets, mounted as files (`NAME_FILE`) through the CSI
  driver; each workload's Google service account can read only its own
  secrets. Manifests hold no secret values and no Kubernetes Secrets.
- Integration tokens stored in the database are envelope-encrypted: a random
  data key per value, wrapped by a Cloud KMS key (automatic rotation;
  re-encryption via the `secrets-reencrypt` operation). A key version is never destroyed
  while data still references it.
- Cloud SQL, Cloud Storage and Secret Manager are encrypted at rest by Google;
  all traffic is TLS.

## 5. Object storage

One private bucket per environment: uniform bucket-level access, public
access prevention enforced, object versioning with a 14-day soft delete. The
application never exposes bucket URLs; downloads go through authorised routes
that check the caller's organisation and permissions. Files moved from the legacy
database store are reconciled by the `files-reconcile` operation (operations Job).

## 6. Deployment

`deploy.yml` (manual, `main` only):

```text
ERP CI + Infrastructure CI + critical ERP browser E2E   (all run inside the deploy run)
       ↓
Build + scan release images (Trivy; fails on fixable critical)
       ↓
Staging: push by digest → migration Job → rollout → smoke → ops status
       ↓
Production approval (GitHub environment protection)
       ↓
Production: same steps → release manifest
```

The previous image digests are recorded before each rollout for rollback.
Terraform changes are planned by `terraform-plan.yml` and applied by an
operator; no workflow applies production infrastructure.

## 7. Migrations: expand / contract

- **Expand** (`database/*/migrations`): backward compatible; the migration Job
  applies them before every rollout while the previous version still runs.
  Files are checksummed and immutable once shipped.
- **Contract** (`database/*/contracts`): destructive cleanup. Never run by the
  deploy. Each file carries its own preconditions; an operator runs
  `db:migrate:contract:plan`, then `db:migrate:contract` once `ops:status`
  shows no blockers ([RELEASE_RUNBOOK.md](../operations/RELEASE_RUNBOOK.md)).

## 8. Backups, PITR and DR limits

- Cloud SQL automated daily backups (14 retained) and point-in-time recovery
  (7 days of transaction logs); production instances are `REGIONAL` (zone
  failover in about two minutes) with deletion protection.
- The **Restore rehearsal** workflow restores into a throwaway instance and
  verifies it; it must pass monthly and after `sql.tf` changes.
- Limits: there is no cross-region replica. A full `asia-south1` outage means
  rebuilding in another region from backups (RPO up to 24 h, RTO 8–24 h). The
  targets in the DR runbook are internal until a rehearsal proves them; no
  customer SLA is implied.
