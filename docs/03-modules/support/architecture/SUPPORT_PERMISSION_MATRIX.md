# Support Permission and Segregation Matrix

| Role | Tickets | Assign/routing | Public reply | Private note | SLA/escalation | Knowledge | Merge/entitlement override | Reports |
|---|---|---|---|---|---|---|---|---|
| Agent | Queue/own scope | Limited | Yes | If sensitive permission | Act | Read/use | No | Own/queue |
| Supervisor | Team/queue | Yes | Yes | Yes | Manage | Read | Approve/request | Team |
| Service manager | Broad company | Yes | Yes | Yes | Policy/manage | Approve | Governed | Full service |
| Knowledge author | Context read | No | No | No | No | Draft/edit | No | Knowledge |
| Customer portal | Own authorized | No | Own public | Never | Own visible targets | Customer-visible | No | Own |
| Auditor | Read | Read history | Read per permission | Sensitive only if granted | Read | Read | Read audit | Audit |
| Admin | Configure | Configure | No implicit business action | No implicit sensitive access | Configure | Configure | No implicit override | Admin |

Private-note visibility, destructive merge, entitlement override and audit export never follow ordinary ticket-read permission by default.
