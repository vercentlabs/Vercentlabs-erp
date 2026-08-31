# Shared Platform Permission & Segregation Matrix

Status: `SPECIFICATION_READY`

| Area | Normal user | Manager/operator | Platform/tenant admin | Sensitive control |
|---|---|---|---|---|
| Identity/session | own profile/sessions | team visibility where allowed | invite/deactivate/reset policy | step-up + audit for recovery/privilege changes |
| Roles/permissions | view effective access | request changes | manage grants within authority | no self-escalation; sensitive grants require policy/approval |
| Tenant/company/branch | assigned scopes only | scoped management | configure organization structure | cross-company/tenant moves specially governed |
| Billing/entitlement | view allowed plan/usage | commercial view if granted | plan/admin operations | callbacks reconciled; billing never implies permission |
| Workflow/automation | use/submit | approve within threshold | configure rules | maker-checker/SoD |
| Audit/security | own/allowed audit | operational review | controlled admin review | no rewrite of audit/security evidence |
| Files/search/reporting | authorized data only | scoped aggregation | platform configuration | no field/record leakage through alternate surfaces |
| Integrations/API | approved tokens/apps | team integrations if granted | register/rotate integrations | secrets hidden; signatures/rate limits/replay controls |
| AI | authorized retrieval/assist | approved recommendations | configure policy/models | no direct DB writes; high-impact actions use normal commands |
