# Private attachment/document bucket: uniform bucket-level access, public
# access prevention enforced, object versioning + soft delete for accidental
# deletion recovery, lifecycle removal of old noncurrent versions.
# Temporary artifacts (report outputs, exports) are attachments with an
# expiry: the worker deletes the object when it expires, and the noncurrent
# copy is removed by the lifecycle rule below; nothing is kept forever.
# Only the web, worker and migration (operations Jobs) service accounts get
# object access (iam.tf); objects are addressed by opaque server-generated keys.

resource "google_storage_bucket" "files" {
  name     = "${var.project_id}-${local.name}-files"
  location = var.storage_location == "" ? upper(var.region) : var.storage_location

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = var.storage_soft_delete_days * 86400
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = var.storage_noncurrent_version_days
      with_state                 = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.apis]
}
