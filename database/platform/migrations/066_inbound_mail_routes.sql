BEGIN;

-- Inbound email routing (Prompt 5). A provider webhook never names the
-- organisation: it posts to /api/platform/mail/inbound/{routeKey}, where the
-- server-generated opaque route key (stored only as a SHA-256 hash) resolves
-- the organisation, the target handler and its configuration. Each route has
-- its own AES-256-GCM encrypted signing secret for the raw-body HMAC.
CREATE TABLE IF NOT EXISTS inbound_mail_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  route_key_hash char(64) NOT NULL UNIQUE,
  route_key_prefix text NOT NULL,
  target text NOT NULL CHECK (target IN ('support.email_to_ticket')),
  -- Support is company-scoped: tickets from this route belong to this company.
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  -- Support records need an attributed actor; mail is recorded as this member,
  -- acting only with the route's narrow authority (create ticket / add an
  -- inbound customer message), never with the member's own permissions.
  recorded_as_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encrypted_signing_secret jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_received_at timestamptz,
  received_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS inbound_mail_routes_org_idx ON inbound_mail_routes (organization_id, status);

ALTER TABLE inbound_mail_events ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES inbound_mail_routes(id) ON DELETE SET NULL;
ALTER TABLE inbound_mail_events ADD COLUMN IF NOT EXISTS ticket_id uuid;
ALTER TABLE inbound_mail_events ADD COLUMN IF NOT EXISTS communication_id uuid;
ALTER TABLE inbound_mail_events ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE inbound_mail_events ADD COLUMN IF NOT EXISTS attachment_notes jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
