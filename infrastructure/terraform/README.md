# Terraform infrastructure

This root module creates the workload namespace, resource quota and safe
container defaults in an existing Kubernetes cluster. Configure the Kubernetes
provider and a remote encrypted state backend outside this directory, then run:

```bash
terraform init
terraform validate
terraform plan -var='environment=staging'
```

Cloud database, object storage, DNS, certificates and secret-manager modules
remain environment-owned because their provider and residency requirements must
be selected explicitly. Never commit plans, state, credentials or provider
caches.
