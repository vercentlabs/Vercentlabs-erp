# Vercentlabs ERP Project Structure

```text
VERCENTLABS ERP/
├─ apps/
│  ├─ landing/                 # Public marketing application
│  ├─ web/                     # Authenticated ERP application
│  └─ mobile/                  # Native CRM mobile client and module shell
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
├─ docs/{architecture,database,api,deployment,modules,commercial}/
├─ tests/{integration,e2e,security}/
└─ .github/workflows/
```

## Permanent rules

- Marketing code belongs in `apps/landing`.
- Authenticated ERP code and current platform Route Handlers belong in `apps/web`.
- Native mobile routes live in `apps/mobile/src/app`; cross-cutting mobile services live in `apps/mobile/src/core`.
- Generated `apps/mobile/android` and `apps/mobile/ios` projects are recreated from Expo configuration and config plugins.
- New business APIs and future backend extraction belong in `services/api`.
- Shared packages cannot import applications or services.
- Control-plane migrations own identity and platform administration.
- Tenant migrations own ERP business records.
- Secrets belong only in ignored local environment files.
- Commands and paths use capability names, never milestone names such as phase1 or phase2.

## Business Data Foundation

- Reusable business queries and mutations belong in `services/api`.
- ERP master records belong in the PostgreSQL `tenant` schema.
- Authenticated tenant Route Handlers remain thin adapters in `apps/web`.
- Shared business resource contracts belong in `packages/shared-types`.
- Tenant-context helpers belong in `packages/database`.

## CRM boundary

- CRM canonical SQL is `database/tenant/migrations/002_crm_module.sql`; reusable CRM services live in `services/api/src/crm.js`; current route adapters and presentation live in `apps/web`.
