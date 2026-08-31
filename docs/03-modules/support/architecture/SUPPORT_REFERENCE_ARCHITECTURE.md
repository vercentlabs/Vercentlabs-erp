# Support Reference Architecture

Command chain: authenticate → organization/company/customer/team/queue scope → module entitlement → Support permission + private-content permission → resolve ticket/customer/contact/context → expected state/version → deterministic lifecycle/SLA/entitlement/routing validation → atomic ticket/history/communication/audit write → public cross-module/outbox intents → retry/reconciliation → visible result.

Email/webhook intake has a separate ingress boundary: verify source/channel → normalize message identity/thread references → tenant/company/mailbox mapping → deduplicate → resolve/create canonical ticket → store message exactly once → route/notify via outbox.
