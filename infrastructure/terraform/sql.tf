# Cloud SQL for PostgreSQL 16: regional HA in production, private IP only,
# TLS required, automated backups + point-in-time recovery, deletion
# protection, storage auto-growth, Query Insights. Storage is encrypted at
# rest by Cloud SQL.
#
# Database USERS are not created here: their passwords would land in
# Terraform state. The bootstrap in docs/operations/PRODUCTION_RUNBOOK.md
# creates the migration owner with gcloud; the migration Job creates and
# re-provisions the web/worker runtime roles (`pnpm db:provision:runtime-role`).
# Operators write the three connection
# strings to the Secret Manager secrets declared in secrets.tf.

locals {
  # A rolling update briefly runs one extra (surge) pod of each Deployment.
  application_connections = (
    (var.web_max_replicas + 1) * var.web_pool_max
    + (var.worker_replicas + 1) * var.worker_pool_max
    + var.migration_pool_max
  )
}

resource "terraform_data" "connection_budget" {
  input = local.application_connections

  lifecycle {
    precondition {
      condition     = local.application_connections + var.sql_admin_reserve_connections <= var.sql_max_connections
      error_message = "Connection budget exceeded: (web_max_replicas+1)*web_pool_max + (worker_replicas+1)*worker_pool_max + migration_pool_max + sql_admin_reserve_connections must be <= sql_max_connections."
    }
  }
}

resource "google_sql_database_instance" "erp" {
  name                = "${local.name}-pg"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.sql_deletion_protection

  settings {
    tier              = var.sql_tier
    edition           = "ENTERPRISE"
    availability_type = local.production ? "REGIONAL" : "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.sql_disk_size_gb
    disk_autoresize   = true

    deletion_protection_enabled = var.sql_deletion_protection

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.vpc.id
      ssl_mode                                      = "ENCRYPTED_ONLY"
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "20:00" # 01:30 IST
      transaction_log_retention_days = var.sql_pitr_log_retention_days
      location                       = var.sql_backup_location == "" ? null : var.sql_backup_location

      backup_retention_settings {
        retained_backups = var.sql_backup_retention_days
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 21
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
    }

    database_flags {
      name  = "max_connections"
      value = tostring(var.sql_max_connections)
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }

    database_flags {
      name  = "cloudsql.enable_pgaudit"
      value = "off"
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "erp" {
  name     = "vercentlabs"
  instance = google_sql_database_instance.erp.name
}
