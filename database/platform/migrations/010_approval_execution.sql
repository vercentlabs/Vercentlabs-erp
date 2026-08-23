BEGIN;

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS command_key text,
  ADD COLUMN IF NOT EXISTS command_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_version_positive'
  ) THEN
    ALTER TABLE approval_requests
      ADD CONSTRAINT approval_requests_version_positive CHECK (version > 0);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  approval_request_id uuid NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'cancelled')),
  note text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  command_result jsonb,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_request_id, version)
);

CREATE INDEX IF NOT EXISTS approval_decisions_org_request_idx
  ON approval_decisions(organization_id, approval_request_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS approval_requests_assignee_pending_idx
  ON approval_requests(organization_id, assigned_to, requested_at DESC)
  WHERE status = 'pending';

COMMIT;
