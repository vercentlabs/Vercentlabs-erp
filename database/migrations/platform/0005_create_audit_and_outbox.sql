CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS integration;

-- Minimum reliable audit foundation for SP001-SP003 mutations. The full
-- SP014 audit-trail capability (query API, retention policy, etc.) remains
-- NOT_STARTED; this table only guarantees every mutation in this prompt
-- writes real, append-only evidence in the same transaction as the change.
CREATE TABLE audit.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  company_id UUID,
  operating_unit_id UUID,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  previous_version INTEGER,
  previous_state TEXT,
  new_version INTEGER,
  new_state TEXT,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  changed_fields JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_actor_type_check CHECK (actor_type IN ('user', 'system', 'integration'))
);

CREATE INDEX audit_events_organization_id_idx ON audit.audit_events (organization_id);
CREATE INDEX audit_events_target_idx ON audit.audit_events (target_type, target_id);
CREATE INDEX audit_events_occurred_at_idx ON audit.audit_events (occurred_at);

COMMENT ON TABLE audit.audit_events IS
  'Append-only audit evidence written in the same transaction as the domain change it records. SP014 (full audit trail platform) remains NOT_STARTED.';

-- Minimum reliable outbox foundation for SP001-SP003 mutations. The full
-- SP015 transactional-outbox-and-delivery capability (dispatcher, retries,
-- dead letters) remains NOT_STARTED; this table only guarantees every
-- mutation writes a real event row in the same transaction as the change.
CREATE TABLE integration.outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  organization_id UUID,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  aggregate_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_state TEXT NOT NULL DEFAULT 'PENDING',
  CONSTRAINT outbox_events_delivery_state_check
    CHECK (delivery_state IN ('PENDING', 'DELIVERED', 'FAILED'))
);

CREATE INDEX outbox_events_delivery_state_idx ON integration.outbox_events (delivery_state);
CREATE INDEX outbox_events_organization_id_idx ON integration.outbox_events (organization_id);
CREATE INDEX outbox_events_aggregate_idx ON integration.outbox_events (aggregate_type, aggregate_id);

COMMENT ON TABLE integration.outbox_events IS
  'Transactional outbox rows written in the same transaction as the domain change. No dispatcher exists yet (SP015 NOT_STARTED) - delivery_state stays PENDING.';
