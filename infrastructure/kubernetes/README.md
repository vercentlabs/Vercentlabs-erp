# Kubernetes infrastructure

The `base` kustomization deploys horizontally scalable web and landing services,
leased one-shot workers, disruption budgets and default-deny ingress policy.

Create `vercentlabs-runtime` and `vercentlabs-landing-runtime` secrets through the
cluster's external-secret controller, then set immutable image digests in an
environment overlay. Validate with `kubectl kustomize infrastructure/kubernetes/base`
before applying. Secrets, certificates and environment-specific host names do
not belong in this repository.


## Immutable release images

The base intentionally uses the all-zero SHA-256 digest so it cannot silently
pull a mutable tag. Every environment overlay must replace the web, landing and
worker digests with digests produced and signed by the release pipeline. Do not
apply the base directly. The worker jobs have execution deadlines, and the
Razorpay webhook retry worker runs every five minutes. The base egress policy
permits only DNS, HTTPS, PostgreSQL and standard secure SMTP ports; narrow the
destination CIDRs further in each environment overlay.
