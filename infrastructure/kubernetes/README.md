# Kubernetes infrastructure

The `base` kustomization deploys horizontally scalable web and landing services,
leased one-shot workers, disruption budgets and default-deny ingress policy.

Create `vercentlabs-runtime` and `vercentlabs-landing-runtime` secrets through the
cluster's external-secret controller, then set immutable image digests in an
environment overlay. Validate with `kubectl kustomize infrastructure/kubernetes/base`
before applying. Secrets, certificates and environment-specific host names do
not belong in this repository.
