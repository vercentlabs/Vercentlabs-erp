# Manufacturing Permission Matrix

| Persona | Engineering | Planning | Release/Execute | Material/Output | Quality hold | Cost | Maintenance | Reports |
|---|---|---|---|---|---|---|---|---|
| Manufacturing engineer | Manage/submit | View | View | View | View | Restricted | View | View |
| Planner | View | Manage | Release per policy | View | View | Restricted | View | Manage |
| Supervisor | View | View | Manage | Post per policy | Request/observe | View | View | Manage |
| Operator | Instructions only | Assigned work | Assigned execute | Scoped scan/post | Cannot release | No sensitive rates | Report downtime | Assigned |
| Quality | View | View | Observe/block | Observe | Inspect/hold/release per policy | Restricted | View | Quality reports |
| Cost accountant | View effective snapshot | View | View | Reconcile | View | Manage/reconcile | View | Cost reports |
| Admin/owner | Governed elevation with audit; elevation never bypasses deterministic state/tenant invariants. | | | | | | | |

Every permission is server-side and company/plant/work-centre scoped; dashboard/export/search aggregates cannot leak restricted engineering, employee or cost data.
