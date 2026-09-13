# platform/notifications

Notifications, preferences and email delivery.

**Shared-platform capabilities:** SP017, SP018

Notifications and preference centre (SP017) and email delivery / inbound-mail platform (SP018).

**Status:** NOT_STARTED. No implementation exists in this module yet; see
[product/registers/shared-platform.yaml](../../product/registers/shared-platform.yaml)
for the authoritative status and
[docs/decisions/ADR-0004-evidence-based-feature-status.md](../../docs/decisions/ADR-0004-evidence-based-feature-status.md)
for why this README cannot mark it complete on its own.

This module must only be consumed by `apps/api` and `apps/worker`, and must
never be imported by `apps/web`. It must interact with other platform
modules only through public commands, queries and events, never by reaching
into another module's private tables.
