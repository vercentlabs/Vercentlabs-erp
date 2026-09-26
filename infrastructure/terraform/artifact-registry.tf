# One Docker repository with immutable tags; images (web, worker, landing,
# migration) are named inside it and deployed by digest. Cleanup keeps the
# recent history needed for rollback.

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "${local.name}-images"
  format        = "DOCKER"
  description   = "Vercentlabs ERP container images (deployed by digest)."

  docker_config {
    immutable_tags = true
  }

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 30
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s" # 30 days
    }
  }

  depends_on = [google_project_service.apis]
}
