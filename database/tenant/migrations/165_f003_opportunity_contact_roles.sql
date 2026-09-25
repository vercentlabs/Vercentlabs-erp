BEGIN;

-- F003 gap-closure (benchmark: "Contact management in top ERPs" report) —
-- tenant.crm_opportunities.contact_id has always been a single-contact
-- pointer (migration 002), the same single-FK limitation the report found
-- Vercentlabs shared only with Odoo among the 7 platforms studied.
-- Salesforce (OpportunityContactRole), SAP (Buying Center), NetSuite
-- (shared Contact Role subtab), Dynamics (Stakeholders) and Zoho (Contact
-- Roles) all let multiple Contacts attach to one deal, each with a role.
--
-- This table is additive, mirroring the exact precedent set by
-- 088_f003_contact_account_relationships.sql for Contact<->Account: the
-- legacy `crm_opportunities.contact_id` pointer is NOT removed or
-- deprecated — it remains the fast "primary contact" pointer every existing
-- caller (Opportunity list/detail queries, reporting) already reads, and is
-- kept in sync with this table's is_primary=true row by the application
-- layer (opportunity-contacts.js) going forward.
--
-- `role` reuses tenant.crm_contact_account_relationships.stakeholder_role's
-- exact vocabulary verbatim — the report specifically called out Vercentlabs
-- reusing one stakeholder-role vocabulary across relationship types as more
-- disciplined than e.g. Salesforce's two uncoordinated Role picklists
-- (AccountContactRelation.Roles vs OpportunityContactRole.Role, which the
-- research notes found can silently diverge with no cross-validation).

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_contact_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  role text
    CHECK (role IS NULL OR role IN (
      'economic_buyer', 'decision_maker', 'champion', 'influencer',
      'user', 'blocker', 'procurement', 'legal', 'technical', 'other'
    )),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, opportunity_id, contact_id),
  FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id)
    REFERENCES tenant.contacts(organization_id, id) ON DELETE CASCADE
);

-- At most one active primary contact role per Opportunity — mirrors
-- crm_contact_account_relationships_primary_idx's "at most one" pattern.
CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunity_contact_roles_primary_idx
  ON tenant.crm_opportunity_contact_roles(organization_id, opportunity_id)
  WHERE is_primary = true AND status = 'active';

CREATE INDEX IF NOT EXISTS crm_opportunity_contact_roles_opportunity_idx
  ON tenant.crm_opportunity_contact_roles(organization_id, opportunity_id, status);
CREATE INDEX IF NOT EXISTS crm_opportunity_contact_roles_contact_idx
  ON tenant.crm_opportunity_contact_roles(organization_id, contact_id, status);

ALTER TABLE tenant.crm_opportunity_contact_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_opportunity_contact_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation
  ON tenant.crm_opportunity_contact_roles;
CREATE POLICY tenant_organization_isolation
  ON tenant.crm_opportunity_contact_roles
  USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
  )
  WITH CHECK (
    organization_id = current_setting('app.current_organization_id', true)::uuid
  );

CREATE OR REPLACE FUNCTION tenant.crm_opportunity_contact_roles_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crm_opportunity_contact_roles_touch
  ON tenant.crm_opportunity_contact_roles;
CREATE TRIGGER crm_opportunity_contact_roles_touch
BEFORE UPDATE ON tenant.crm_opportunity_contact_roles
FOR EACH ROW EXECUTE FUNCTION tenant.crm_opportunity_contact_roles_touch();

-- Backfill: every Opportunity with an existing single contact_id becomes
-- that Contact's primary role on the deal. Idempotent via ON CONFLICT DO
-- NOTHING against the (organization_id, opportunity_id, contact_id) unique
-- constraint.
INSERT INTO tenant.crm_opportunity_contact_roles
  (organization_id, opportunity_id, contact_id, is_primary, status, created_by, updated_by, created_at, updated_at)
SELECT
  opportunity.organization_id,
  opportunity.id,
  opportunity.contact_id,
  true,
  'active',
  opportunity.created_by,
  opportunity.updated_by,
  opportunity.created_at,
  opportunity.updated_at
FROM tenant.crm_opportunities opportunity
WHERE opportunity.contact_id IS NOT NULL
ON CONFLICT (organization_id, opportunity_id, contact_id) DO NOTHING;

COMMENT ON TABLE tenant.crm_opportunity_contact_roles
  IS 'F003: governed multi-Contact Opportunity roles (deal buying-committee style, benchmark gap-closure). crm_opportunities.contact_id remains the fast primary-Contact pointer, kept in sync with the is_primary=true row here by the application layer. Rollback: DROP TABLE — crm_opportunities.contact_id is untouched by this migration and remains independently correct if this table is ever dropped.';

COMMIT;
