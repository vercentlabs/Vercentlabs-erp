# Support Pass 10 Test Strategy

1. Domain/property tests for ticket state, numbering, SLA calendar arithmetic, pause/resume and metric formulas.
2. Database/RLS/IDOR tests across organization/company/queue/customer/portal scope.
3. Private-note and attachment non-leakage tests across list/detail/search/export/notification/portal.
4. Email threading tests: duplicate delivery, Message-ID/In-Reply-To/References, loops, spoofed threading, delayed replies and retries.
5. Concurrency tests for assignment/routing, close-vs-reply, SLA jobs, merge chains and reopen.
6. Idempotency/outbox tests for escalation, notification, CSAT, cross-module investigation and entitlement queries.
7. Attachment malware/quarantine/storage/download fault injection.
8. Search/performance tests for large queues/history/knowledge.
9. Cross-module Sales/Assets/Quality contract and reconciliation tests.
10. Browser/device E2E + WCAG checks for agent workspace and portal.
