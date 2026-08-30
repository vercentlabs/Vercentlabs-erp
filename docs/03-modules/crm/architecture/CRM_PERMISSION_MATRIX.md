# CRM Pass 1 Permission Model

| Persona | Typical record scope | Configuration | Bulk/import/export | Revenue/forecast | Sensitive communications |
|---|---|---|---|---|---|
| REP/SDR | Own/assigned | No | Limited by explicit permission | Own opportunities/forecast | Participant/allowed record content only |
| MGR | Team/subordinate | Limited | Team-scoped where granted | Team pipeline/forecast; controlled override | Team policy; never implicit all-mail access |
| OPS | Organization/company | CRM configuration | Import/export/data quality/bulk as granted | Analytics/configuration | Only if separately granted |
| ADMIN | Organization | Full CRM config | Explicit high-risk permission | Configuration/override | Separate sensitive-content permission still applies |
| INT | OAuth/service scope | None unless dedicated | Contract-specific | Contract-specific | Minimum required fields only |

Server enforcement is mandatory. UI visibility is only an affordance and never the authorization boundary.
