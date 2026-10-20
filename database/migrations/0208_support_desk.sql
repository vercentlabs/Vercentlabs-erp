-- Support — the ticket desk (MVP 37), rebuilt over tenant.support_tickets / support_communications (additive):
--   1. tickets: their source (MANUAL | EMAIL) and source message, the support mailbox, the unmatched-sender flag and its candidates, reopening
--      (reopened_at; a reply to a closed ticket opens a follow-up linked to it);
--   2. messages: what each one is (CUSTOMER message, agent REPLY, private NOTE, SYSTEM), the outbound email's delivery state as the mail
--      queue reports it (QUEUED, SENT, FAILED, BOUNCED — never "delivered" because an API accepted it), its Message-ID and thread headers,
--      recipients and the mail-log row;
--   3. support_mailboxes: the authorized support addresses — inbound route, defaults (category, priority, agent), acknowledgement, the
--      reopening policy and blocked senders / domains;
--   4. response and resolution targets by priority (settings), used when no active SLA policy applies;
--   5. permissions support.ticket.view_all / reply / note / reopen and support.mailbox.manage, with role grants.
-- Re-runnable.

-- ============================================================ 1. tickets
ALTER TABLE tenant.support_tickets
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS source_message_id text,
  ADD COLUMN IF NOT EXISTS mailbox_id uuid,
  ADD COLUMN IF NOT EXISTS sender_unmatched boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sender_candidates jsonb,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_of_ticket_id uuid,
  ADD COLUMN IF NOT EXISTS last_customer_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_agent_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
UPDATE tenant.support_tickets SET source = 'EMAIL' WHERE channel = 'email' AND source = 'MANUAL';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_source_check') THEN
    ALTER TABLE tenant.support_tickets ADD CONSTRAINT support_tickets_source_check CHECK (source IN ('MANUAL', 'EMAIL'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON tenant.support_tickets (organization_id, status);
CREATE INDEX IF NOT EXISTS support_tickets_agent_idx ON tenant.support_tickets (organization_id, assigned_user_id, status);
CREATE INDEX IF NOT EXISTS support_tickets_customer_email_idx ON tenant.support_tickets (organization_id, lower(customer_email));

-- ============================================================ 2. messages
ALTER TABLE tenant.support_communications
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS delivery_error text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS mail_log_id uuid,
  ADD COLUMN IF NOT EXISTS mailbox_id uuid,
  ADD COLUMN IF NOT EXISTS in_reply_to text,
  ADD COLUMN IF NOT EXISTS reference_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS to_addresses text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cc_addresses text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text;
UPDATE tenant.support_communications SET kind = CASE WHEN private_note THEN 'NOTE' WHEN direction = 'inbound' THEN 'CUSTOMER' WHEN direction = 'outbound' THEN 'REPLY' ELSE 'SYSTEM' END WHERE kind IS NULL;
UPDATE tenant.support_communications SET delivery_status = CASE WHEN direction = 'inbound' THEN 'RECEIVED' WHEN direction = 'outbound' THEN 'SENT' ELSE NULL END
 WHERE delivery_status IS NULL AND kind IN ('CUSTOMER', 'REPLY');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_communications_kind_check') THEN
    ALTER TABLE tenant.support_communications ADD CONSTRAINT support_communications_kind_check CHECK (kind IS NULL OR kind IN ('CUSTOMER', 'REPLY', 'NOTE', 'SYSTEM'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_communications_delivery_check') THEN
    ALTER TABLE tenant.support_communications ADD CONSTRAINT support_communications_delivery_check
      CHECK (delivery_status IS NULL OR delivery_status IN ('RECEIVED', 'QUEUED', 'SENT', 'FAILED', 'BOUNCED', 'NOT_SENT'));
  END IF;
  -- A private note is never an email: it has no recipients and no delivery.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_communications_note_check') THEN
    ALTER TABLE tenant.support_communications ADD CONSTRAINT support_communications_note_check
      CHECK (kind IS DISTINCT FROM 'NOTE' OR (private_note AND delivery_status IS NULL AND cardinality(to_addresses) = 0));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS support_communications_message_uidx ON tenant.support_communications (organization_id, external_message_id) WHERE external_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS support_communications_key_uidx ON tenant.support_communications (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_communications_mail_idx ON tenant.support_communications (mail_log_id) WHERE mail_log_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON tenant.support_communications TO vercent_app, vercent_worker;

-- ============================================================ 3. support mailboxes
CREATE TABLE IF NOT EXISTS tenant.support_mailboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  address text NOT NULL CHECK (address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text,
  inbound_route_id uuid,
  default_category_id uuid,
  default_priority text NOT NULL DEFAULT 'normal' CHECK (default_priority IN ('low', 'normal', 'high', 'urgent')),
  default_agent_user_id uuid,
  auto_acknowledge boolean NOT NULL DEFAULT true,
  reply_reopens_resolved boolean NOT NULL DEFAULT true,
  blocked_senders text[] NOT NULL DEFAULT '{}',
  blocked_domains text[] NOT NULL DEFAULT '{}',
  signature text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, address)
);
CREATE UNIQUE INDEX IF NOT EXISTS support_mailboxes_route_uidx ON tenant.support_mailboxes (organization_id, inbound_route_id) WHERE inbound_route_id IS NOT NULL;
DO $$
BEGIN
  ALTER TABLE tenant.support_mailboxes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE tenant.support_mailboxes FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'support_mailboxes' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.support_mailboxes USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.support_mailboxes TO vercent_app, vercent_worker;

-- ============================================================ 4. targets by priority
ALTER TABLE tenant.support_settings
  ADD COLUMN IF NOT EXISTS response_targets jsonb NOT NULL DEFAULT '{"low": {"response": 1440, "resolution": 7200}, "normal": {"response": 480, "resolution": 2880}, "high": {"response": 120, "resolution": 1440}, "urgent": {"response": 30, "resolution": 480}}',
  ADD COLUMN IF NOT EXISTS reopen_on_customer_reply boolean NOT NULL DEFAULT true;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('support.ticket.view_all', 'View every ticket', 'Support', 'See tickets assigned to anyone, not only your own and the unassigned ones.'),
  ('support.ticket.reply', 'Reply to customers', 'Support', 'Send a reply from a ticket through an authorized support mailbox.'),
  ('support.ticket.note', 'Write private notes', 'Support', 'Add staff-only notes, which are never emailed.'),
  ('support.ticket.reopen', 'Reopen tickets', 'Support', 'Return a resolved or closed ticket to active work.'),
  ('support.mailbox.manage', 'Manage support mailboxes', 'Support', 'Connect support addresses, their defaults and their spam controls.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('support_manager'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('support.ticket.view_all'), ('support.ticket.reply'), ('support.ticket.note'), ('support.ticket.reopen'), ('support.mailbox.manage')) AS k(key)
    UNION ALL
    SELECT * FROM (VALUES
      ('customer_success_manager', 'support.view'), ('customer_success_manager', 'support.ticket.create'), ('customer_success_manager', 'support.ticket.reply'),
      ('customer_success_manager', 'support.ticket.note'), ('customer_success_manager', 'support.ticket.assign'), ('customer_success_manager', 'support.ticket.resolve'),
      ('customer_success_manager', 'support.communication.manage'),
      ('sales_manager', 'support.view'), ('sales_manager', 'support.ticket.create'), ('sales_manager', 'support.ticket.note'),
      ('auditor', 'support.view'), ('auditor', 'support.ticket.view_all'), ('auditor', 'support.reports.view'), ('auditor', 'support.audit.view')
    ) AS pair(slug, key)
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0208_support_desk.sql', 'support-desk') ON CONFLICT DO NOTHING;
