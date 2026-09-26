variable "project_id" {
  description = "Google Cloud project that hosts this environment. Never hard-coded; pass per environment."
  type        = string
}

variable "region" {
  description = "Primary region for GKE, Cloud SQL, Cloud Storage, KMS and Artifact Registry (India default)."
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "name_prefix" {
  description = "Short prefix for resource names."
  type        = string
  default     = "vercent-erp"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,14}$", var.name_prefix))
    error_message = "name_prefix must be 3-15 lowercase letters, digits or hyphens."
  }
}

variable "kubernetes_namespace" {
  description = "Namespace the ERP workloads run in (must match the Kubernetes overlay)."
  type        = string
  default     = "vercentlabs"
}

# ------------------------------------------------------------------ network

variable "subnet_cidr" {
  description = "Primary range for GKE nodes."
  type        = string
  default     = "10.10.0.0/20"
}

variable "pods_cidr" {
  description = "Secondary range for pods."
  type        = string
  default     = "10.20.0.0/14"
}

variable "services_cidr" {
  description = "Secondary range for services."
  type        = string
  default     = "10.24.0.0/20"
}

variable "master_ipv4_cidr" {
  description = "/28 for the GKE control plane private endpoint."
  type        = string
  default     = "172.16.0.0/28"
}

variable "control_plane_authorized_networks" {
  description = "CIDRs allowed to reach the GKE control plane (operators/CI). Empty = no public access beyond Google-internal."
  type        = list(object({ cidr = string, name = string }))
  default     = []
}

# ------------------------------------------------------------------ GKE

variable "gke_release_channel" {
  description = "GKE release channel."
  type        = string
  default     = "REGULAR"
}

variable "gke_deletion_protection" {
  description = "Protect the cluster from terraform destroy."
  type        = bool
  default     = true
}

# ------------------------------------------------------------------ Cloud SQL

variable "sql_tier" {
  description = "Cloud SQL machine tier. Size it from the connection budget below and the load baseline."
  type        = string
  default     = "db-custom-2-7680"
}

variable "sql_disk_size_gb" {
  description = "Initial SSD size; storage auto-grows."
  type        = number
  default     = 50
}

variable "sql_max_connections" {
  description = "PostgreSQL max_connections flag. Must cover the application connection budget plus admin headroom."
  type        = number
  default     = 200
}

variable "sql_backup_retention_days" {
  description = "Automated backups kept."
  type        = number
  default     = 14
}

variable "sql_pitr_log_retention_days" {
  description = "Point-in-time recovery window (transaction logs), 1-7 days."
  type        = number
  default     = 7
  validation {
    condition     = var.sql_pitr_log_retention_days >= 1 && var.sql_pitr_log_retention_days <= 7
    error_message = "sql_pitr_log_retention_days must be between 1 and 7."
  }
}

variable "sql_backup_location" {
  description = "Backup location (multi-region or region). Empty = Cloud SQL default for the instance region."
  type        = string
  default     = ""
}

variable "sql_deletion_protection" {
  description = "Protect the database instance from deletion."
  type        = bool
  default     = true
}

# ------------------------------------------------------ connection budget
# (web_max_replicas + 1 surge) x web_pool_max + (worker_replicas + 1 surge) x
# worker_pool_max + migration_pool_max (one Job) must stay within
# sql_max_connections - sql_admin_reserve_connections (checked in sql.tf).

variable "web_max_replicas" {
  type    = number
  default = 6
}

variable "web_pool_max" {
  description = "DATABASE_POOL_MAX per web pod."
  type        = number
  default     = 10
}

variable "worker_replicas" {
  type    = number
  default = 2
}

variable "worker_pool_max" {
  description = "DATABASE_POOL_MAX per worker pod (>= WORKER_CONCURRENCY + 3)."
  type        = number
  default     = 6
}

variable "migration_pool_max" {
  type    = number
  default = 2
}

variable "sql_admin_reserve_connections" {
  description = "Connections reserved for operators, Cloud SQL maintenance and the Auth Proxy."
  type        = number
  default     = 25
}

# ------------------------------------------------------------------ storage

variable "storage_location" {
  description = "Bucket location; defaults to the primary region for data residency."
  type        = string
  default     = ""
}

variable "storage_soft_delete_days" {
  description = "Cloud Storage soft-delete retention for accidental deletion recovery."
  type        = number
  default     = 14
}

variable "storage_noncurrent_version_days" {
  description = "Days a replaced/deleted object version is kept before lifecycle removes it."
  type        = number
  default     = 30
}


# ------------------------------------------------------------------ KMS

variable "kms_rotation_period" {
  description = "Automatic rotation for the secrets key-encryption key."
  type        = string
  default     = "7776000s" # 90 days
}

# ----------------------------------------------------------- CI/CD (GitHub)

variable "github_repository" {
  description = "owner/name of the GitHub repository allowed to deploy through Workload Identity Federation."
  type        = string
}

variable "github_deploy_ref" {
  description = "Git ref allowed to obtain deployment credentials."
  type        = string
  default     = "refs/heads/main"
}

# ---------------------------------------------------------- public edge

variable "armor_auth_rate_limit_per_minute" {
  description = "Per-IP requests/minute to /api/auth/* before Cloud Armor throttles (application rate limits still apply)."
  type        = number
  default     = 120
}

variable "armor_waf_preview" {
  description = "Run the preconfigured WAF rules in preview (log-only). Switch off only after reviewing logs."
  type        = bool
  default     = true
}

# ------------------------------------------------------------- monitoring

variable "alert_email" {
  description = "Email notification channel for alerts. Empty = alerts are created without a channel."
  type        = string
  default     = ""
}
