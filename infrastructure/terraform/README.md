# Terraform — Google Cloud

Production and staging run on Google Cloud (region `asia-south1` by default).
One root module, one state per environment, split by concern:

| File | Resources |
| --- | --- |
| `versions.tf` / `providers.tf` | Terraform ≥ 1.8, `hashicorp/google` 6.x, GCS remote state (partial config), labels |
| `network.tf` | Required APIs, private VPC + GKE subnet (pod/service ranges), Cloud Router + NAT, private services access for Cloud SQL, global static IP for the load balancer |
| `gke.tf` | Regional GKE **Autopilot** cluster: private nodes, Dataplane V2 (NetworkPolicy), Secret Manager add-on, dedicated node service account, maintenance window |
| `sql.tf` | Cloud SQL for PostgreSQL 16: regional HA (production), private IP only, TLS required, backups + PITR, deletion protection, auto-growing SSD, Query Insights, `max_connections`; the **connection budget** precondition |
| `storage.tf` | Private files bucket: uniform access, public access prevention, versioning, soft delete, lifecycle for noncurrent versions and `tmp/` exports |
| `kms.tf` | Key ring + `integration-secrets` KEK (90-day rotation) for envelope encryption |
| `secrets.tf` | Secret Manager secret **containers** and per-workload accessor bindings (no values) |
| `artifact-registry.tf` | Docker repository with immutable tags and cleanup policies |
| `iam.tf` | Service accounts (web, worker, migration, nodes, deployer), Workload Identity bindings, GitHub OIDC Workload Identity Federation |
| `security.tf` | Cloud Armor edge policy, TLS 1.2+ SSL policy |
| `monitoring.tf` | Log-based metrics and alert policies (email channel optional) |

Never commit state, plans, `.terraform/`, credentials or real `*.tfvars`
(`.gitignore` blocks them). Terraform never holds secret **values**: secret
versions and database passwords are created by operators (see below), so
nothing sensitive is written to state.

## Bootstrap (once per environment)

The state bucket and the read-only planner identity are created **before**
this configuration and are not managed by it (it never creates the backend
it stores its own state in). Run as a project owner:

```bash
PROJECT=<project-id>; REGION=asia-south1; ENV=production
gcloud config set project "$PROJECT"
gcloud services enable storage.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com

# 1. Remote state bucket: versioned, uniform access, no public access.
gcloud storage buckets create "gs://$PROJECT-tfstate" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$PROJECT-tfstate" --versioning

# 2. Read-only planner for the Terraform plan workflow (GitHub OIDC).
gcloud iam service-accounts create vercent-erp-tf-planner --display-name="Terraform planner ($ENV)"
PLANNER="vercent-erp-tf-planner@$PROJECT.iam.gserviceaccount.com"
for role in roles/viewer roles/iam.securityReviewer roles/secretmanager.viewer roles/cloudkms.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$PLANNER" --role="$role"
done
gcloud storage buckets add-iam-policy-binding "gs://$PROJECT-tfstate" --member="serviceAccount:$PLANNER" --role=roles/storage.objectUser
gcloud iam workload-identity-pools create tf-github --location=global --display-name="Terraform plan (GitHub)"
gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=tf-github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment" \
  --attribute-condition="assertion.repository=='<owner>/<repo>' && assertion.ref=='refs/heads/main' && assertion.environment=='$ENV-infrastructure'"
gcloud iam service-accounts add-iam-policy-binding "$PLANNER" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe $PROJECT --format='value(projectNumber)')/locations/global/workloadIdentityPools/tf-github/attribute.repository/<owner>/<repo>"
```

## Plan and apply

```bash
cd infrastructure/terraform
terraform init -backend-config="bucket=$PROJECT-tfstate" -backend-config="prefix=erp/$ENV"
terraform plan -var-file=$ENV.tfvars -out=tfplan     # review
terraform apply tfplan                                  # operator, own credentials
```

`terraform.tfvars.example` lists every input. The **Terraform plan**
workflow (`.github/workflows/terraform-plan.yml`, manual, GitHub environment
`<env>-infrastructure` with required reviewers) produces a reviewed plan with
the read-only planner; nothing applies automatically, and pull requests only
run `fmt`/`validate` (`infrastructure-ci.yml`) with no cloud credentials.

## After the first apply

1. **Secrets** — add a version to each secret the environment uses
   (`terraform output secret_ids`), e.g.
   `printf '%s' "$VALUE" | gcloud secrets versions add vercent-erp-production-smtp-password --data-file=-`.
   Optional integrations (OAuth, CRM inbound, legacy key) are enabled per
   overlay through `infrastructure/kubernetes/components/` only once their
   secret has a version.
2. **Database roles** — create the migration owner once:
   `gcloud sql users create vercent_migrator --instance=<instance> --password=<generated>`,
   then write the three connection strings (all `127.0.0.1:5432`, through the
   Auth Proxy sidecar) to `database-url-migration`, `database-url-web`
   (`vercent_web`), `database-url-worker` (`vercent_worker`). The first
   migration Job creates the web/worker roles with those passwords.
3. **DNS** (at the domain registrar; not automated) — create `A` records for
   the ERP and landing hostnames pointing to `terraform output ingress_ip_address`.
   The Google-managed certificate becomes Active once DNS resolves (up to
   ~60 minutes); HTTP is redirected to HTTPS by the load balancer.
4. **GitHub** — create environments `staging`, `production` (required
   reviewers, deployment branch `main` only) and `<env>-infrastructure`, and
   set the variables listed at the top of `.github/workflows/deploy.yml` and
   `terraform-plan.yml` from `terraform output`.

## Connection budget

`(web_max_replicas + 1) × web_pool_max + (worker_replicas + 1) × worker_pool_max
+ migration_pool_max + sql_admin_reserve_connections ≤ sql_max_connections`
is enforced by a precondition in `sql.tf`. Defaults: `7×10 + 3×6 + 2 + 25 = 115 ≤ 200`.
Raise `web_max_replicas` only together with `sql_max_connections`/`sql_tier`,
and keep the Kubernetes HPA (`overlays/*`) and `WEB_POOL_MAX`/`WORKER_POOL_MAX`
deploy values in step.
