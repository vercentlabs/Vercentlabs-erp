BEGIN;

CREATE TABLE IF NOT EXISTS tenant.support_settings (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  default_priority text NOT NULL DEFAULT 'normal',
  require_resolution_code boolean NOT NULL DEFAULT true,
  prohibit_self_closure boolean NOT NULL DEFAULT false,
  reopen_window_days integer NOT NULL DEFAULT 7 CHECK (reopen_window_days >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,company_id)
);

CREATE TABLE IF NOT EXISTS tenant.support_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  parent_category_id uuid REFERENCES tenant.support_categories(id),
  default_priority text NOT NULL DEFAULT 'normal'
    CHECK (default_priority IN ('low','normal','high','urgent','critical')),
  default_queue_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.support_queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  manager_user_id uuid,
  default_sla_policy_id uuid,
  assignment_strategy text NOT NULL DEFAULT 'manual'
    CHECK (assignment_strategy IN ('manual','round_robin','least_loaded','skills_based')),
  business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.support_queue_members (
  organization_id uuid NOT NULL,
  queue_id uuid NOT NULL REFERENCES tenant.support_queues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  skill_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  capacity integer NOT NULL DEFAULT 20 CHECK (capacity > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_id,user_id)
);

CREATE TABLE IF NOT EXISTS tenant.support_sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  priority text
    CHECK (priority IN ('low','normal','high','urgent','critical')),
  first_response_minutes integer NOT NULL CHECK (first_response_minutes > 0),
  resolution_minutes integer NOT NULL CHECK (resolution_minutes > 0),
  pause_on_pending_customer boolean NOT NULL DEFAULT true,
  business_hours_only boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  ticket_number text NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  channel text NOT NULL
    CHECK (channel IN ('web','email','phone','chat','whatsapp','social','internal')),
  category_id uuid REFERENCES tenant.support_categories(id),
  queue_id uuid REFERENCES tenant.support_queues(id),
  assigned_user_id uuid,
  customer_id uuid,
  contact_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  related_crm_record_type text,
  related_crm_record_id uuid,
  related_sales_order_id uuid,
  related_invoice_id uuid,
  related_asset_id uuid,
  related_project_id uuid,
  related_quality_record_type text,
  related_quality_record_id uuid,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent','critical')),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','open','pending_customer','pending_internal','resolved','closed','cancelled')),
  sla_policy_id uuid REFERENCES tenant.support_sla_policies(id),
  first_response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_responded_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  resolution_code text,
  resolution_summary text,
  satisfaction_score integer CHECK (satisfaction_score BETWEEN 1 AND 5),
  source_reference text,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,ticket_number)
);

CREATE TABLE IF NOT EXISTS tenant.support_ticket_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES tenant.support_tickets(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  reason text,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.support_ticket_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES tenant.support_tickets(id) ON DELETE CASCADE,
  from_queue_id uuid,
  to_queue_id uuid,
  from_user_id uuid,
  to_user_id uuid,
  reason text,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.support_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES tenant.support_tickets(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound','internal')),
  channel text NOT NULL
    CHECK (channel IN ('web','email','phone','chat','whatsapp','social','internal')),
  subject text,
  body text NOT NULL,
  sender_name text,
  sender_address text,
  recipient_address text,
  external_message_id text,
  private_note boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.support_escalation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  trigger_type text NOT NULL
    CHECK (trigger_type IN ('first_response_risk','resolution_risk','priority','customer_tier','manual')),
  trigger_value text,
  target_queue_id uuid REFERENCES tenant.support_queues(id),
  target_user_id uuid,
  priority_override text
    CHECK (priority_override IN ('low','normal','high','urgent','critical')),
  notification_targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.support_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES tenant.support_tickets(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES tenant.support_escalation_policies(id),
  escalation_level integer NOT NULL DEFAULT 1 CHECK (escalation_level > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','resolved','cancelled')),
  escalated_to_queue_id uuid,
  escalated_to_user_id uuid,
  escalated_by uuid,
  escalated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS tenant.support_knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  article_number text NOT NULL,
  title text NOT NULL,
  summary text,
  content text NOT NULL,
  category_id uuid REFERENCES tenant.support_categories(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','published','retired')),
  visibility text NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal','customer','public')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  helpful_count integer NOT NULL DEFAULT 0,
  not_helpful_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  approved_by uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,article_number,version)
);

CREATE TABLE IF NOT EXISTS tenant.support_ticket_knowledge_links (
  organization_id uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES tenant.support_tickets(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES tenant.support_knowledge_articles(id),
  link_type text NOT NULL DEFAULT 'suggested'
    CHECK (link_type IN ('suggested','used','resolution')),
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id,article_id)
);

CREATE TABLE IF NOT EXISTS tenant.support_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  ticket_id uuid,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_tickets_queue_idx
  ON tenant.support_tickets(organization_id,company_id,queue_id,status,priority);
CREATE INDEX IF NOT EXISTS support_tickets_assignee_idx
  ON tenant.support_tickets(organization_id,assigned_user_id,status,resolution_due_at);
CREATE INDEX IF NOT EXISTS support_tickets_customer_idx
  ON tenant.support_tickets(organization_id,customer_id,created_at);
CREATE INDEX IF NOT EXISTS support_communications_ticket_idx
  ON tenant.support_communications(organization_id,ticket_id,created_at);
CREATE INDEX IF NOT EXISTS support_escalations_open_idx
  ON tenant.support_escalations(organization_id,status,escalated_at);
CREATE INDEX IF NOT EXISTS support_events_aggregate_idx
  ON tenant.support_events(organization_id,aggregate_type,aggregate_id,occurred_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'support_settings',
    'support_categories',
    'support_queues',
    'support_queue_members',
    'support_sla_policies',
    'support_tickets',
    'support_ticket_status_history',
    'support_ticket_assignments',
    'support_communications',
    'support_escalation_policies',
    'support_escalations',
    'support_knowledge_articles',
    'support_ticket_knowledge_links',
    'support_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON tenant.%I',
      table_name || '_organization_isolation',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
