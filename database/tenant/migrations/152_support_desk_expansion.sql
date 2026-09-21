BEGIN;

-- Expands the Support / Customer Service foundation (migration 050) into the full desk: tags,
-- product linkage, merge, reopen tracking and CSAT fields on the ticket itself; attachments; canned
-- responses; entitlements (warranty/service-plan); a customer portal login link; and routing rules for
-- automatic queue assignment (F343-F380). customer_id/contact_id stay loosely typed uuids (no FK), the
-- same convention every other module uses for tenant.business_parties/tenant.contacts references.

ALTER TABLE tenant.support_tickets
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS product_id uuid,
  ADD COLUMN IF NOT EXISTS entitlement_id uuid,
  ADD COLUMN IF NOT EXISTS merged_into_ticket_id uuid REFERENCES tenant.support_tickets(id),
  ADD COLUMN IF NOT EXISTS csat_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS csat_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS csat_comment text,
  ADD COLUMN IF NOT EXISTS sla_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_paused_minutes integer NOT NULL DEFAULT 0 CHECK (sla_paused_minutes >= 0),
  ADD COLUMN IF NOT EXISTS reopened_count integer NOT NULL DEFAULT 0 CHECK (reopened_count >= 0);

ALTER TABLE tenant.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_status_check;
ALTER TABLE tenant.support_tickets ADD CONSTRAINT support_tickets_status_check
  CHECK (status IN ('new','open','pending_customer','pending_internal','resolved','closed','cancelled','merged'));

CREATE INDEX IF NOT EXISTS support_tickets_merged_idx ON tenant.support_tickets(organization_id, merged_into_ticket_id) WHERE merged_into_ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_tickets_tags_idx ON tenant.support_tickets USING gin (tags);

-- F358: attachments, on a ticket or on one specific communication within it.
CREATE TABLE IF NOT EXISTS tenant.support_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES tenant.support_tickets(id) ON DELETE CASCADE,
  communication_id uuid REFERENCES tenant.support_communications(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  storage_key text NOT NULL,
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','failed')),
  private_note boolean NOT NULL DEFAULT false,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_attachments_ticket_idx ON tenant.support_attachments(organization_id, ticket_id);

-- F370: canned responses, personal or shared, optionally scoped to a category.
CREATE TABLE IF NOT EXISTS tenant.support_canned_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  category_id uuid REFERENCES tenant.support_categories(id),
  subject text,
  body text NOT NULL,
  shared boolean NOT NULL DEFAULT true,
  owner_user_id uuid,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code)
);

-- F375: a service-plan / warranty entitlement, for a customer and (optionally) one product, distinct
-- from a physical asset's own warranty dates (read directly from tenant.assets when a ticket links one).
CREATE TABLE IF NOT EXISTS tenant.support_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  entitlement_number text NOT NULL,
  party_id uuid NOT NULL,
  product_id uuid,
  tier text NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard','premium','enterprise')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','warranty','subscription')),
  sla_policy_id uuid REFERENCES tenant.support_sla_policies(id),
  starts_on date NOT NULL,
  ends_on date,
  ticket_quota integer CHECK (ticket_quota IS NULL OR ticket_quota > 0),
  tickets_used integer NOT NULL DEFAULT 0 CHECK (tickets_used >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','expired','cancelled')),
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entitlement_number),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS support_entitlements_party_idx ON tenant.support_entitlements(organization_id, party_id, status);

-- F371: the customer portal login link -- a platform user (an organization member, minimal/no support
-- permissions) linked to the customer party/contact they may act as, mirroring HR employee self-service.
CREATE TABLE IF NOT EXISTS tenant.support_portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  party_id uuid NOT NULL,
  contact_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS support_portal_users_party_idx ON tenant.support_portal_users(organization_id, party_id);

-- F352: automatic routing -- first matching rule (by sequence) sets the queue/priority/category a new
-- ticket lands in; unmatched tickets fall back to the category's default queue, then stay unassigned.
CREATE TABLE IF NOT EXISTS tenant.support_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  sequence integer NOT NULL DEFAULT 100,
  match_channel text CHECK (match_channel IN ('web','email','phone','chat','whatsapp','social','internal')),
  match_category_id uuid REFERENCES tenant.support_categories(id),
  match_keyword text,
  target_queue_id uuid REFERENCES tenant.support_queues(id),
  target_priority text CHECK (target_priority IN ('low','normal','high','urgent','critical')),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code)
);
CREATE INDEX IF NOT EXISTS support_routing_rules_active_idx ON tenant.support_routing_rules(organization_id, company_id, active, sequence);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'support_attachments',
    'support_canned_responses',
    'support_entitlements',
    'support_portal_users',
    'support_routing_rules'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON tenant.%I', table_name || '_organization_isolation', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
