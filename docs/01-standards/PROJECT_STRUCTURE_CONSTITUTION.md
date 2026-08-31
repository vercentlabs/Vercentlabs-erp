# Project Structure Constitution

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

```text
apps/web/src/app/              # routing and transport composition only
apps/web/src/core/             # shared protected ERP platform capabilities
apps/web/src/modules/          # module-owned web experience
apps/web/src/shared/           # generic reusable UI/helpers
apps/mobile/src/app/           # route composition
apps/mobile/src/core/          # auth/API/security/offline providers
apps/mobile/src/modules/       # module-owned native screens/adapters/offline handlers
apps/mobile/src/shared/        # shared native UI
services/api/src/core/         # server domain/platform support
services/api/src/modules/      # 12 business-module public contracts/domain logic
services/api/src/orchestration/# cross-module workflow coordinators
services/worker/               # durable async handlers/jobs/queue
packages/                      # reusable platform libraries only
database/platform/             # control-plane/platform migrations
database/tenant/               # tenant business-data migrations
tests/integration/             # cross-module/contract tests
tests/security/                # tenant/RBAC/IDOR/security-negative tests
scripts/validation/            # deterministic release/architecture verification
docs/                          # source of truth / traceability
```

## Ownership
- F-IDs are documentation/traceability anchors, never source-code directories.
- Each business module owns its private data model and domain decisions.
- Another module may interact only through a public module command/query/event contract.
- Multi-module business coordination belongs in `services/api/src/orchestration`.
- Route handlers are thin transport adapters; they do not become a second domain layer.
- Shared packages may contain genuinely cross-module primitives, never module-specific shortcuts disguised as shared code.
- Mobile and web consume the same server-side business truth and permission model.
