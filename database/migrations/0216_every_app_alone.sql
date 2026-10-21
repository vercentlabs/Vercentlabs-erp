-- Every app alone (MVP 45): each app works with no other app switched on.
--
-- 1. Point of Sale without Stock: an outlet needs no selling warehouse, and a sale line sold without stock has none.
-- 2. "Not GST registered" stops GST on sales only: tax_settings.purchase_tax_enabled keeps the GST suppliers charge on purchase documents
--    (it cannot be claimed back while the company is not registered).
-- 3. A workspace has the basics before anyone opens Settings:
-- tenant.seed_starter_data(organization, actor) adds what each app needs for its first record, only where the workspace has none:
--   * Products: a "General" product category (any item type), so the first product can be saved;
--   * Sales and Purchase: the default payment term ("Due on Receipt", IMMEDIATE, which every workspace is given at registration);
--   * Projects: the project types (the same list migration 0125 gave the workspaces that existed then);
--   * Assets: four asset categories from the starter templates (Office Furniture, Computers & Laptops, Vehicles, Plant & Machinery).
-- Registration calls it for a new workspace (core/organization/starter-data.js); below, it runs once for every existing one.
-- Re-runnable: each part checks for what is already there.

ALTER TABLE tenant.pos_stores ALTER COLUMN warehouse_id DROP NOT NULL;
ALTER TABLE tenant.pos_sale_lines ALTER COLUMN warehouse_id DROP NOT NULL;

ALTER TABLE tenant.tax_settings ADD COLUMN IF NOT EXISTS purchase_tax_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION tenant.seed_starter_data(p_organization_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  actor uuid := COALESCE(p_actor, (SELECT created_by FROM public.organizations WHERE id = p_organization_id));
  template record;
  allocated bigint;
  category tenant.asset_categories%ROWTYPE;
BEGIN
  -- A product category any item type can use.
  IF NOT EXISTS (SELECT 1 FROM tenant.item_groups WHERE organization_id = p_organization_id) THEN
    INSERT INTO tenant.item_groups (organization_id, code, name, description, status, created_by, updated_by)
    VALUES (p_organization_id, 'GENERAL', 'General', 'Products and services that need no category of their own.', 'active', actor, actor)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Sales' default payment term: Due on Receipt.
  INSERT INTO tenant.sales_settings (organization_id, default_payment_term_id, created_by, updated_by)
  SELECT p_organization_id, term.id, actor, actor FROM tenant.payment_terms term
   WHERE term.organization_id = p_organization_id AND term.code = 'IMMEDIATE' AND term.status = 'active'
  ON CONFLICT (organization_id) DO UPDATE SET default_payment_term_id = EXCLUDED.default_payment_term_id, updated_at = now()
   WHERE tenant.sales_settings.default_payment_term_id IS NULL;

  -- Purchase's default payment term (a new supplier takes it): the same Due on Receipt.
  INSERT INTO tenant.procurement_settings (organization_id, default_payment_term_id, updated_by)
  SELECT p_organization_id, term.id, actor FROM tenant.payment_terms term
   WHERE term.organization_id = p_organization_id AND term.code = 'IMMEDIATE' AND term.status = 'active'
  ON CONFLICT (organization_id) DO UPDATE SET default_payment_term_id = EXCLUDED.default_payment_term_id, updated_at = now()
   WHERE tenant.procurement_settings.default_payment_term_id IS NULL;

  -- Project types.
  IF NOT EXISTS (SELECT 1 FROM tenant.project_types WHERE organization_id = p_organization_id) THEN
    INSERT INTO tenant.project_types (organization_id, code, name, description, sort_order, created_by)
    SELECT p_organization_id, kind.code, kind.name, kind.description, kind.sort_order, actor FROM (VALUES
        ('INTERNAL', 'Internal initiative', 'An initiative inside the company', 10),
        ('CLIENT', 'Client project', 'Work delivered for a customer', 20),
        ('IMPLEMENTATION', 'Customer implementation', 'Setting up a product or system for a customer', 30),
        ('SOFTWARE', 'Software development', 'Building or changing software', 40),
        ('DESIGN', 'Design', 'Website, product or graphic design', 50),
        ('CONSTRUCTION', 'Construction or installation', 'Site work, installation and commissioning', 60),
        ('MARKETING', 'Marketing campaign', 'A campaign or launch', 70),
        ('CONSULTING', 'Consulting engagement', 'Advisory or professional services', 80),
        ('OTHER', 'Other', 'Anything else', 90)
      ) AS kind(code, name, description, sort_order)
    ON CONFLICT (organization_id, code) DO NOTHING;
  END IF;

  -- Asset categories, numbered from the workspace's own asset-category series (ACAT-000001, as the Assets app numbers them).
  IF actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.asset_categories WHERE organization_id = p_organization_id) THEN
    FOR template IN SELECT * FROM (VALUES
        (1, 'furniture', 'Office Furniture', 'CAPITALIZE', 'OPTIONAL', 'OPTIONAL', true, 'ALLOWED', false, false, 120, 'Desks, chairs and cabinets — location tracking'),
        (2, 'computers', 'Computers & Laptops', 'CAPITALIZE', 'REQUIRED', 'REQUIRED', true, 'ALLOWED', true, true, 36, 'Desktops, laptops and workstations — serial and custody tracking'),
        (3, 'vehicles', 'Vehicles', 'CAPITALIZE', 'REQUIRED', 'OPTIONAL', true, 'ALLOWED', true, true, 96, 'Cars and delivery vans — identification and maintenance'),
        (4, 'plant', 'Plant & Machinery', 'CAPITALIZE', 'OPTIONAL', 'REQUIRED', true, 'NOT_APPLICABLE', true, true, 180, 'Manufacturing machines — location and maintenance')
      ) AS t(position, template_key, name, guidance, serial_policy, tag_policy, location_required, custodian_policy, warranty, maintenance, life_months, description)
      ORDER BY position
    LOOP
      INSERT INTO tenant.document_sequences (organization_id, document_type, period_key, prefix, padding, next_value)
      VALUES (p_organization_id, 'asset_category', 'global', 'ACAT-', 6, 2)
      ON CONFLICT (organization_id, document_type, period_key) DO UPDATE SET next_value = tenant.document_sequences.next_value + 1, updated_at = now()
      RETURNING next_value - 1 INTO allocated;
      INSERT INTO tenant.asset_categories (organization_id, code, name, description, created_by, template_key, active, tag_prefix, asset_type, capitalization_guidance,
          serial_number_policy, serial_required, asset_tag_policy, location_required, custodian_policy, warranty_applicable, maintenance_applicable, verification_applicable,
          suggested_condition, useful_life_months, depreciation_method)
      VALUES (p_organization_id, 'ACAT-' || lpad(allocated::text, 6, '0'), template.name, template.description, actor, template.template_key, true, 'AST', 'TANGIBLE', template.guidance,
          template.serial_policy, template.serial_policy = 'REQUIRED', template.tag_policy, template.location_required, template.custodian_policy, template.warranty, template.maintenance, true,
          'NEW', template.life_months, 'straight_line')
      RETURNING * INTO category;
      INSERT INTO tenant.asset_category_policy_versions (organization_id, category_id, version, effective_from, operational, finance, reason, created_by)
      VALUES (p_organization_id, category.id, category.policy_version, current_date,
        jsonb_build_object('assetType', category.asset_type, 'capitalizationGuidance', category.capitalization_guidance, 'serialNumberPolicy', category.serial_number_policy,
          'assetTagPolicy', category.asset_tag_policy, 'locationRequired', category.location_required, 'custodianPolicy', category.custodian_policy,
          'warrantyApplicable', category.warranty_applicable, 'maintenanceApplicable', category.maintenance_applicable, 'verificationApplicable', category.verification_applicable,
          'scrapEvidenceRequired', category.scrap_evidence_required, 'suggestedCondition', category.suggested_condition, 'defaultDepartmentId', category.default_department_id,
          'ownershipApplicability', category.ownership_applicability),
        jsonb_build_object('accountingClass', NULL, 'depreciationMethod', category.depreciation_method, 'usefulLifeMonths', category.useful_life_months::text,
          'residualValuePercent', category.residual_value_percent::text, 'decliningRate', category.declining_rate::text, 'depreciationConvention', NULL, 'taxDepreciationReference', NULL,
          'capitalizationThreshold', category.capitalization_threshold::text, 'assetAccountId', NULL, 'accumulatedDepreciationAccountId', NULL, 'depreciationExpenseAccountId', NULL,
          'gainLossAccountId', NULL, 'disposalLossAccountId', NULL, 'proceedsAccountId', NULL, 'cwipAccountId', NULL, 'financePolicyEffectiveFrom', NULL),
        'Starter template', actor);
      INSERT INTO tenant.asset_category_events (organization_id, category_id, action, changes, policy_version, actor_user_id)
      VALUES (p_organization_id, category.id, 'CREATED', jsonb_build_object('name', category.name, 'template', template.template_key), 1, actor);
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant.seed_starter_data(uuid, uuid) TO vercent_app;

-- Every existing workspace gets what it is missing.
DO $$
DECLARE
  organization record;
BEGIN
  FOR organization IN SELECT id, created_by FROM public.organizations LOOP
    PERFORM tenant.seed_starter_data(organization.id, organization.created_by);
  END LOOP;
END;
$$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0216_every_app_alone.sql', 'every-app-alone') ON CONFLICT DO NOTHING;
