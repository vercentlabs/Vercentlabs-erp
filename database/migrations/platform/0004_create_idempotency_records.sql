-- Generic idempotency infrastructure (packages/database), reused by any
-- unsafe creation/lifecycle command. organization_id is nullable because
-- platform-operator operations (e.g. create organization) have no existing
-- organization to scope to; actor_id + operation_name + key together
-- provide the real scope key (NULL columns are never equal to each other
-- under a UNIQUE constraint, so organization_id alone would not work here).
CREATE TABLE platform.idempotency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES platform.organizations (id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL,
  operation_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  processing_state TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT idempotency_records_scope_key
    UNIQUE (actor_id, operation_name, idempotency_key),
  CONSTRAINT idempotency_records_state_check
    CHECK (processing_state IN ('IN_PROGRESS', 'COMPLETED', 'FAILED'))
);

CREATE INDEX idempotency_records_expires_at_idx ON platform.idempotency_records (expires_at);
CREATE INDEX idempotency_records_organization_id_idx ON platform.idempotency_records (organization_id);

COMMENT ON TABLE platform.idempotency_records IS
  'Records one attempt per (actor, operation, Idempotency-Key) so retried unsafe requests replay the original result instead of re-executing.';
