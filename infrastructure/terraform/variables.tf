variable "namespace" {
  description = "Kubernetes namespace reserved for the ERP workloads."
  type        = string
  default     = "vercentlabs"
  validation {
    condition     = can(regex("^[a-z0-9]([-a-z0-9]*[a-z0-9])?$", var.namespace))
    error_message = "namespace must be a valid Kubernetes DNS label."
  }
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging or production."
  }
}

variable "resource_quota" {
  description = "Namespace-wide guardrails; size these after load tests."
  type = object({
    cpu_requests    = string
    memory_requests = string
    cpu_limits      = string
    memory_limits   = string
    pods            = string
  })
  default = {
    cpu_requests    = "4"
    memory_requests = "8Gi"
    cpu_limits      = "16"
    memory_limits   = "24Gi"
    pods            = "50"
  }
}
