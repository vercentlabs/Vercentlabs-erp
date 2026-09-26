# Secret Manager secret CONTAINERS and per-workload access. Terraform never
# holds secret VALUES (they would be stored in state): operators add
# versions with `gcloud secrets versions add` (docs/operations/PRODUCTION_RUNBOOK.md).
# The GKE Secret Manager add-on mounts each secret as a file; the application
# reads NAME from NAME_FILE (packages/config loadSecretFiles).

locals {
  # secret id => workloads allowed to read it
  secrets = {
    # The migration Job re-provisions the runtime roles after every expand
    # migration (grants per classified table, passwords from these URLs).
    "database-url-web"                    = ["web", "migration"]
    "database-url-worker"                 = ["worker", "migration"]
    "database-url-migration"              = ["migration"]
    "smtp-password"                       = ["web", "worker"]
    "auth-email-webhook-secret"           = ["web"]
    "razorpay-key-secret"                 = ["web", "worker"]
    "razorpay-webhook-secret"             = ["web"]
    "razorpay-webhook-secret-previous"    = ["web"]
    "google-oauth-client-secret"          = ["web", "worker"]
    "microsoft-oauth-client-secret"       = ["web", "worker"]
    "attachment-scan-token"               = ["web", "worker"]
    "crm-capture-proxy-secret"            = ["web", "landing"]
    "crm-inbound-email-secret"            = ["web"]
    "crm-provider-webhook-secret"         = ["web"]
    "crm-acquisition-webhook-secret"      = ["web"]
    "integration-token-encryption-legacy" = ["web", "worker", "migration"] # decrypt-only until secrets:migrate-legacy completes
  }

  secret_access = flatten([
    for id, workloads in local.secrets : [
      for workload in workloads : { id = id, workload = workload }
    ]
  ])
}

resource "google_secret_manager_secret" "runtime" {
  for_each  = local.secrets
  secret_id = "${local.name}-${each.key}"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each  = { for entry in local.secret_access : "${entry.id}/${entry.workload}" => entry }
  secret_id = google_secret_manager_secret.runtime[each.value.id].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload[each.value.workload].email}"
}
