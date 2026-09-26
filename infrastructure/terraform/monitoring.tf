# A small set of actionable alerts (severity and response in
# docs/operations/PRODUCTION_RUNBOOK.md#alerts). Application signals come
# from structured JSON logs (@vercentlabs/observability) through log-based
# metrics; platform signals from built-in GKE / Cloud SQL / load balancer
# metrics.

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email == "" ? 0 : 1
  display_name = "Vercentlabs ERP ${var.environment} on-call"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

locals {
  channels = [for channel in google_monitoring_notification_channel.email : channel.id]

  # Structured log events counted as metrics (low cardinality: no user or
  # record ids as labels).
  log_metrics = {
    "worker-job-dead"          = "jsonPayload.event=\"worker.job.dead\""
    "webhook-delivery-dead"    = "jsonPayload.event=\"webhook.delivery.dead\""
    "billing-webhook-dead"     = "jsonPayload.event=\"billing.webhook.dead_letter\""
    "billing-reconcile-failed" = "jsonPayload.event=\"billing.reconciliation.failed\""
    "storage-failure"          = "jsonPayload.event=\"files.storage.failed\""
    "readiness-failed"         = "jsonPayload.event=\"readiness.failed\""
  }
}

resource "google_logging_metric" "events" {
  for_each = local.log_metrics
  name     = "${local.name}/${each.key}"
  filter   = "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"${var.kubernetes_namespace}\" AND ${each.value}"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "log_events" {
  for_each     = local.log_metrics
  display_name = "[${var.environment}] ${each.key}"
  combiner     = "OR"
  severity     = contains(["billing-webhook-dead", "readiness-failed", "storage-failure"], each.key) ? "CRITICAL" : "WARNING"

  conditions {
    display_name = each.key
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.events[each.key].name}\" AND resource.type=\"k8s_container\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = local.channels
  documentation {
    content   = "See docs/operations/PRODUCTION_RUNBOOK.md#alerts (${each.key})."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "web_5xx" {
  display_name = "[${var.environment}] Web 5xx rate"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "Load balancer 5xx responses"
    condition_threshold {
      filter          = "metric.type=\"loadbalancing.googleapis.com/https/request_count\" AND resource.type=\"https_lb_rule\" AND metric.labels.response_code_class=500"
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }
  notification_channels = local.channels
  documentation {
    content   = "See docs/operations/PRODUCTION_RUNBOOK.md#alerts (web-5xx)."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "crash_loop" {
  display_name = "[${var.environment}] Pod restarts (crash loop)"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "Container restarts in the ERP namespace"
    condition_threshold {
      filter          = "metric.type=\"kubernetes.io/container/restart_count\" AND resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"${var.kubernetes_namespace}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 3
      duration        = "0s"
      aggregations {
        alignment_period     = "600s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.container_name"]
      }
    }
  }
  notification_channels = local.channels
  documentation {
    content   = "See docs/operations/PRODUCTION_RUNBOOK.md#alerts (crash-loop)."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "worker_down" {
  display_name = "[${var.environment}] Worker not running"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "No running worker containers"
    condition_absent {
      filter   = "metric.type=\"kubernetes.io/container/uptime\" AND resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"${var.kubernetes_namespace}\" AND resource.labels.container_name=\"worker\""
      duration = "600s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = local.channels
  documentation {
    content   = "See docs/operations/PRODUCTION_RUNBOOK.md#alerts (worker-down)."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "sql" {
  for_each = {
    cpu         = { metric = "cloudsql.googleapis.com/database/cpu/utilization", threshold = 0.85 }
    disk        = { metric = "cloudsql.googleapis.com/database/disk/utilization", threshold = 0.85 }
    connections = { metric = "cloudsql.googleapis.com/database/postgresql/num_backends", threshold = var.sql_max_connections * 0.85 }
  }
  display_name = "[${var.environment}] Cloud SQL ${each.key}"
  combiner     = "OR"
  severity     = "WARNING"
  conditions {
    display_name = "Cloud SQL ${each.key} high"
    condition_threshold {
      filter          = "metric.type=\"${each.value.metric}\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.erp.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = "600s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = local.channels
  documentation {
    content   = "See docs/operations/PRODUCTION_RUNBOOK.md#alerts (sql-${each.key})."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "sql_down" {
  display_name = "[${var.environment}] Cloud SQL unavailable"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "Cloud SQL instance down"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/up\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${google_sql_database_instance.erp.name}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MIN"
      }
    }
  }
  notification_channels = local.channels
  documentation {
    content   = "See docs/operations/DISASTER_RECOVERY_RUNBOOK.md (Cloud SQL outage)."
    mime_type = "text/markdown"
  }
}
