# Key-encryption key for integration secrets (OAuth tokens, webhook and
# inbound-mail signing secrets, MFA secrets). The application stores only
# DEK-wrapped envelopes; this key never leaves Cloud KMS. Rotation creates a
# new primary version; `pnpm secrets:reencrypt` rewraps existing envelopes.

resource "google_kms_key_ring" "erp" {
  name       = "${local.name}-keys"
  location   = var.region
  depends_on = [google_project_service.apis]
}

resource "google_kms_crypto_key" "secrets" {
  name            = "integration-secrets"
  key_ring        = google_kms_key_ring.erp.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = var.kms_rotation_period

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    prevent_destroy = true
  }
}
