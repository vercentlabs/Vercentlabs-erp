# Quality Permission and Segregation Matrix

| Role | Plans/specs | Inspect/results | Hold/NCR | Release/use-as-is/disposition | CAPA/audit | Reports |
|---|---|---|---|---|---|---|
| Inspector | Read | Execute | Create | No/limited | No | Own/operational |
| Quality engineer | Draft/manage | Execute/review | Manage | Request | Manage actions | Quality scope |
| Quality manager | Approve | Review | Manage | Approve | Approve/close | Full quality |
| Supplier-quality | Supplier scope | Incoming | Supplier NCR | Request/RTS | Supplier CAPA | Supplier |
| Auditor | Read | Read | Read | No | Audit/findings | Read/export |
| Warehouse/production supervisor | Read applicable | Source view | View/block reason | No unless explicitly delegated | No | Operational |
| System/admin | Configure scope | No implicit quality decision | No implicit release | No bypass | Configure | Admin |

Configured self-approval is blocked for hold release, use-as-is/deviation, sensitive dispositions, audit independence and CAPA effectiveness verification.
