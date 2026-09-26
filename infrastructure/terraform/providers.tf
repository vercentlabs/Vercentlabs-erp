provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = local.labels
}

locals {
  name = "${var.name_prefix}-${var.environment}"

  labels = {
    "app"         = "vercentlabs-erp"
    "environment" = var.environment
    "managed-by"  = "terraform"
  }

  production = var.environment == "production"

  # Kubernetes service accounts (namespace/name) that impersonate the Google
  # service accounts through GKE Workload Identity.
  workload_identity_pool = "${var.project_id}.svc.id.goog"
}
