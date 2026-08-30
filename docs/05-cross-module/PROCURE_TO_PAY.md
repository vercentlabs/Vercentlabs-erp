# Procure to Pay

Status: `UNSPECIFIED`

For every transition document:
- trigger and initiating actor/channel
- source aggregate and owning module
- destination public command/query
- permissions and scope
- validations/invariants
- transaction boundary
- idempotency key and duplicate behavior
- outbox/event and async worker behavior
- failure, retry and dead-letter handling
- audit evidence
- visible user state while processing
- resulting records and financial/stock implications
- reversal/compensation path
- reconciliation and exception queue
- automated integration tests and human UAT
