output "cluster_name" {
  value = google_container_cluster.erp.name
}

output "cluster_location" {
  value = google_container_cluster.erp.location
}

output "sql_instance_connection_name" {
  description = "Cloud SQL Auth Proxy target (project:region:instance)."
  value       = google_sql_database_instance.erp.connection_name
}

output "sql_database" {
  value = google_sql_database.erp.name
}

output "files_bucket" {
  description = "OBJECT_STORAGE_BUCKET for the web and worker."
  value       = google_storage_bucket.files.name
}

output "secrets_kms_key_name" {
  description = "SECRETS_KMS_KEY_NAME for the web and worker."
  value       = google_kms_crypto_key.secrets.id
}

output "image_repository" {
  description = "Artifact Registry path prefix for images."
  value       = "${google_artifact_registry_repository.images.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "workload_service_accounts" {
  description = "Google service accounts to annotate on the Kubernetes service accounts."
  value       = { for key, account in google_service_account.workload : key => account.email }
}

output "deployer_service_account" {
  value = google_service_account.deployer.email
}

output "github_workload_identity_provider" {
  description = "workload_identity_provider input for google-github-actions/auth."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "ingress_ip_name" {
  description = "Global static IP name for the Ingress annotation."
  value       = google_compute_global_address.ingress.name
}

output "ingress_ip_address" {
  description = "Point the DNS A records for the ERP and landing hostnames here (at the registrar)."
  value       = google_compute_global_address.ingress.address
}

output "edge_security_policy" {
  description = "Cloud Armor policy name for the GKE BackendConfig."
  value       = google_compute_security_policy.edge.name
}

output "secret_ids" {
  description = "Secret Manager secret ids (values are added by operators, never by Terraform)."
  value       = { for key, secret in google_secret_manager_secret.runtime : key => secret.secret_id }
}

output "application_connection_budget" {
  value = local.application_connections
}

output "ssl_policy" {
  description = "SSL policy name for the Kubernetes FrontendConfig."
  value       = google_compute_ssl_policy.tls.name
}

output "private_services_cidr" {
  description = "Cloud SQL private services range (NetworkPolicy egress to the database)."
  value       = "${google_compute_global_address.private_services.address}/${google_compute_global_address.private_services.prefix_length}"
}
