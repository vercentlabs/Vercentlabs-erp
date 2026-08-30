# POS Permission and Segregation Matrix

| Role | Checkout | Price/discount override | Returns/refunds | Cash/shift | Reconciliation/admin |
|---|---|---|---|---|---|
| Cashier | Assigned shift | Configured limits | Request/limited | Own shift | No |
| Supervisor | Yes | Approve | Approve | Close/variance | Store-level |
| Store manager | Yes | Policy | Approve | Full store | Store reports |
| Finance | View | No | Financial review | Review | Reconcile/post intents |
| Retail admin | Configure | Policies | Policies | Configure | Cross-store admin |
| Auditor | Read | Read history | Read | Read | Read/export |

Raw card PAN/CVV is outside POS persistence. Sensitive customer/provider/cash fields use field/record scope and authorization-safe aggregates.
