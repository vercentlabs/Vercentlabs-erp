terraform {
  required_version = ">= 1.8.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.20"
    }
  }

  # Remote state in a GCS bucket created ONCE by the bootstrap step
  # (infrastructure/terraform/bootstrap/README.md). Partial configuration:
  #   terraform init -backend-config="bucket=<state-bucket>" -backend-config="prefix=erp/<environment>"
  # This configuration never creates the bucket it stores its own state in.
  backend "gcs" {}
}
