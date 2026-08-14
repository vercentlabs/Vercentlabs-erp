BEGIN;

-- CRM-017: model every supported Lead routing strategy explicitly.
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid='tenant.crm_lead_assignment_policies'::regclass
       AND contype='c'
       AND pg_get_constraintdef(oid) ILIKE '%mode%'
  LOOP
    EXECUTE format('ALTER TABLE tenant.crm_lead_assignment_policies DROP CONSTRAINT %I', item.conname);
  END LOOP;
END $$;

ALTER TABLE tenant.crm_lead_assignment_policies
  ADD CONSTRAINT crm_lead_assignment_policies_mode_check
    CHECK (mode IN ('fixed','round_robin','territory','workload')),
  ADD CONSTRAINT crm_lead_assignment_policies_strategy_shape_check
    CHECK (
      (mode='fixed' AND assignee_user_id IS NOT NULL)
      OR (mode IN ('round_robin','workload') AND cardinality(member_user_ids)>0)
      OR (mode='territory' AND territory_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS crm_leads_owner_active_idx
  ON tenant.crm_leads(organization_id,owner_user_id,status)
  WHERE status NOT IN ('converted','archived');

CREATE INDEX IF NOT EXISTS crm_territory_assignments_lead_routing_idx
  ON tenant.crm_territory_assignments(
    organization_id,territory_id,assignee_type,effective_from,effective_to
  );

-- CRM-014: first-class application-side inbound-email acquisition provider.
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid='tenant.crm_lead_acquisition_connections'::regclass
       AND contype='c'
       AND pg_get_constraintdef(oid) ILIKE '%provider%'
  LOOP
    EXECUTE format('ALTER TABLE tenant.crm_lead_acquisition_connections DROP CONSTRAINT %I', item.conname);
  END LOOP;
END $$;

ALTER TABLE tenant.crm_lead_acquisition_connections
  ADD CONSTRAINT crm_lead_acquisition_connections_provider_check
    CHECK (
      provider IN (
        'google_ads','meta','linkedin','instagram','facebook','whatsapp',
        'website_chat','inbound_email','custom','mock'
      )
    );

COMMIT;
