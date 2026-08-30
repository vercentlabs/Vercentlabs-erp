# Stock Permission Matrix

| Action | Operator | Warehouse Manager | Inventory Controller | Quality | Inventory Accountant |
|---|---|---|---|---|---|
| View permitted warehouse quantities | Yes | Yes | Yes | scoped | Yes |
| Receive / issue / transfer | scoped | Yes | Yes | scoped | No |
| Adjust stock | No/default | policy | Yes | No | No |
| Reserve/release | scoped service/user | Yes | Yes | No | No |
| Count | Yes | Yes | Yes | No | No |
| Approve large variance/exception | No | policy | Yes | No | policy |
| Hold/release quality stock | No | No | view | Yes | No |
| View valuation/cost | No/default | policy | Yes | No/default | Yes |
| Change costing policy | No | No | policy | No | controlled |

All permissions are enforced server-side with organization/company/warehouse and record/dimension scope.
