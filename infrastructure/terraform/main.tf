resource "kubernetes_namespace_v1" "erp" {
  metadata {
    name = var.namespace
    labels = {
      "app.kubernetes.io/part-of"    = "vercent-erp"
      "app.kubernetes.io/managed-by" = "terraform"
      "vercentlabs.com/environment"  = var.environment
    }
  }
}

resource "kubernetes_resource_quota_v1" "erp" {
  metadata {
    name      = "vercent-namespace-quota"
    namespace = kubernetes_namespace_v1.erp.metadata[0].name
  }
  spec {
    hard = {
      "requests.cpu"    = var.resource_quota.cpu_requests
      "requests.memory" = var.resource_quota.memory_requests
      "limits.cpu"      = var.resource_quota.cpu_limits
      "limits.memory"   = var.resource_quota.memory_limits
      "pods"            = var.resource_quota.pods
    }
  }
}

resource "kubernetes_limit_range_v1" "erp" {
  metadata {
    name      = "vercent-container-defaults"
    namespace = kubernetes_namespace_v1.erp.metadata[0].name
  }
  spec {
    limit {
      type = "Container"
      default_request = {
        cpu    = "100m"
        memory = "128Mi"
      }
      default = {
        cpu    = "1"
        memory = "1Gi"
      }
    }
  }
}
