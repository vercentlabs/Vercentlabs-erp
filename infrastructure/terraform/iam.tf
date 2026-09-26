# Dedicated, least-privilege Google service accounts. No Compute Engine
# default account, no Editor, no service-account keys: pods impersonate
# through GKE Workload Identity, GitHub Actions through Workload Identity
# Federation (OIDC).

locals {
  workloads = {
    web       = { ksa = "web", description = "ERP web runtime" }
    worker    = { ksa = "erp-worker", description = "ERP background worker" }
    migration = { ksa = "migration", description = "Database migration and operations Jobs" }
    landing   = { ksa = "landing", description = "Public landing site" }
  }

  # Workloads that reach Cloud SQL through the Auth Proxy (not the landing site).
  database_workloads = toset(["web", "worker", "migration"])
}

resource "google_service_account" "workload" {
  for_each     = local.workloads
  account_id   = "${var.name_prefix}-${each.key}"
  display_name = "${each.value.description} (${var.environment})"
}

# Kubernetes service account -> Google service account.
resource "google_service_account_iam_member" "workload_identity" {
  for_each           = local.workloads
  service_account_id = google_service_account.workload[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${local.workload_identity_pool}[${var.kubernetes_namespace}/${each.value.ksa}]"
}

# Cloud SQL Auth Proxy connectivity for the three database authorities.
resource "google_project_iam_member" "sql_client" {
  for_each = local.database_workloads
  project  = var.project_id
  role     = "roles/cloudsql.client"
  member   = "serviceAccount:${google_service_account.workload[each.key].email}"
}

# Structured logs, metrics and error reports.
resource "google_project_iam_member" "telemetry" {
  for_each = {
    for pair in setproduct(["web", "worker", "migration", "landing"], ["roles/logging.logWriter", "roles/monitoring.metricWriter", "roles/errorreporting.writer"]) :
    "${pair[0]}/${pair[1]}" => { workload = pair[0], role = pair[1] }
  }
  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.workload[each.value.workload].email}"
}

# Object access on the one files bucket (not project-wide storage roles).
# The migration identity also runs the operations Jobs (files:migrate-legacy,
# files:reconcile).
resource "google_storage_bucket_iam_member" "files" {
  for_each = toset(["web", "worker", "migration"])
  bucket   = google_storage_bucket.files.name
  role     = "roles/storage.objectUser"
  member   = "serviceAccount:${google_service_account.workload[each.key].email}"
}

# Envelope encryption: encrypt/decrypt with the secrets KEK only (migration:
# the secrets:reencrypt and secrets:migrate-legacy operations Jobs).
resource "google_kms_crypto_key_iam_member" "secrets" {
  for_each      = toset(["web", "worker", "migration"])
  crypto_key_id = google_kms_crypto_key.secrets.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.workload[each.key].email}"
}

# ------------------------------------------------------------ CI/CD deployer

resource "google_service_account" "deployer" {
  account_id   = "${var.name_prefix}-deployer"
  display_name = "GitHub Actions deployer (${var.environment})"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "${local.name}-github"
  display_name              = "GitHub Actions (${var.environment})"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"         = "assertion.sub"
    "attribute.repository"   = "assertion.repository"
    "attribute.ref"          = "assertion.ref"
    "attribute.environment"  = "assertion.environment"
    "attribute.workflow_ref" = "assertion.job_workflow_ref"
  }

  # Only this repository, only the deploy ref, only from the matching GitHub
  # environment (which carries the required-reviewer protection).
  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.ref == '${var.github_deploy_ref}' && assertion.environment == '${var.environment}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deployer_federation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Push images to this repository only.
resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# Apply manifests and run the migration Job inside the cluster (Kubernetes
# RBAC in the overlay narrows it further); read the cluster endpoint.
resource "google_project_iam_member" "deployer_gke" {
  for_each = toset(["roles/container.developer", "roles/container.clusterViewer"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# ---------------------------------------------------------------- GKE nodes
# Autopilot nodes run as this minimal account, never the Compute Engine
# default service account.

resource "google_service_account" "nodes" {
  account_id   = "${var.name_prefix}-nodes"
  display_name = "GKE Autopilot nodes (${var.environment})"
}

resource "google_project_iam_member" "nodes" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/stackdriver.resourceMetadata.writer",
    "roles/autoscaling.metricsWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.nodes.email}"
}

# Nodes pull images from this repository only.
resource "google_artifact_registry_repository_iam_member" "nodes_pull" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.nodes.email}"
}
