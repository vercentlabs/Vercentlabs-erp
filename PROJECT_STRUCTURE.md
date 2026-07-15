# Vercent ERP Project Structure

```text
VERCENTLABS ERP/
├─ apps/
│  ├─ landing/                 # Public marketing application
│  ├─ web/                     # Authenticated ERP application
│  └─ mobile/                  # Future mobile workspace
├─ services/
│  └─ api/                     # Permanent backend service boundary
├─ packages/
│  ├─ shared-types/
│  ├─ shared-sdk/
│  ├─ shared-ui/
│  ├─ config/
│  ├─ database/
│  ├─ permissions/
│  ├─ workflows/
│  ├─ document-engine/
│  ├─ reporting-engine/
│  ├─ localization/
│  ├─ observability/
│  └─ test-utils/
├─ database/
│  ├─ control-plane/{migrations,seeds}/
│  └─ tenant/{migrations,seeds,policies,views,functions}/
├─ infrastructure/{docker,kubernetes,terraform}/
├─ scripts/{devex,database,deployment,validation}/
├─ docs/{architecture,database,api,deployment,modules}/
├─ tests/{integration,e2e,security}/
└─ .github/workflows/
```

## Permanent rules

- Marketing code belongs in `apps/landing`.
- Authenticated ERP code and current platform Route Handlers belong in `apps/web`.
- New business APIs and future backend extraction belong in `services/api`.
- Shared packages cannot import applications or services.
- Control-plane migrations own identity and platform administration.
- Tenant migrations own ERP business records.
- Secrets belong only in ignored local environment files.
- Commands and paths use capability names, never milestone names such as phase1 or phase2.
