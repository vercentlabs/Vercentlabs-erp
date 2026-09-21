# Execution plan

Order follows dependencies. Each item ends with tests run and a local commit; nothing is pushed until the owner asks.

A. Foundation (done, see current-state.md): TLS policy, body limit, cache clearing, locale, POS offline seed recovery, inventory generator.
B. Browser-level verification of A: Playwright specs for tenant switch cache isolation, oversize request (413), POS offline reload-sell-reconnect.
C. CRM completion: Lead Lifecycle, Custom Fields & Tags, Record Fields, Forecast, remaining raw enums, unsaved-changes warning.
D. PLANNED workspaces: sales availability, manufacturing resources, HR reports, accounting credit / reconciliation / TDS-TCS / prepayments / revenue schedules.
E. Review queue: the 112 features no source cites and the 104 with backend-only evidence. For each, decide built-uncited, missing, or server-only.
F. Cross-module journeys with two tenants and reconciliation checks.
G. CI: make the critical ERP Playwright suite a required gate; explicit ERP build command.
H. Accessibility and responsive sweeps at 360/768/1024/1440.
