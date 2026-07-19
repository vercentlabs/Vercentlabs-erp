output "namespace" {
  description = "Namespace to target from the Kubernetes deployment overlay."
  value       = kubernetes_namespace_v1.erp.metadata[0].name
}
