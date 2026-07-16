BEGIN;
-- Every tenant row receives an organization-aware candidate key.
CREATE UNIQUE INDEX IF NOT EXISTS currencies_organization_id_id_uidx
  ON tenant.currencies(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_organization_id_id_uidx
  ON tenant.exchange_rates(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_periods_organization_id_id_uidx
  ON tenant.fiscal_periods(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS units_of_measure_organization_id_id_uidx
  ON tenant.units_of_measure(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS tax_categories_organization_id_id_uidx
  ON tenant.tax_categories(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS tax_rates_organization_id_id_uidx
  ON tenant.tax_rates(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_terms_organization_id_id_uidx
  ON tenant.payment_terms(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_term_lines_organization_id_id_uidx
  ON tenant.payment_term_lines(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS business_parties_organization_id_id_uidx
  ON tenant.business_parties(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_organization_id_id_uidx
  ON tenant.contacts(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS addresses_organization_id_id_uidx
  ON tenant.addresses(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS item_groups_organization_id_id_uidx
  ON tenant.item_groups(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS items_organization_id_id_uidx
  ON tenant.items(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS item_uom_conversions_organization_id_id_uidx
  ON tenant.item_uom_conversions(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_organization_id_id_uidx
  ON tenant.warehouses(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_locations_organization_id_id_uidx
  ON tenant.warehouse_locations(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS price_lists_organization_id_id_uidx
  ON tenant.price_lists(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS price_list_items_organization_id_id_uidx
  ON tenant.price_list_items(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS master_data_external_ids_organization_id_id_uidx
  ON tenant.master_data_external_ids(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS master_data_import_jobs_organization_id_id_uidx
  ON tenant.master_data_import_jobs(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_settings_organization_id_id_uidx
  ON tenant.crm_settings(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_pipelines_organization_id_id_uidx
  ON tenant.crm_pipelines(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_pipeline_stages_organization_id_id_uidx
  ON tenant.crm_pipeline_stages(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_sources_organization_id_id_uidx
  ON tenant.crm_lead_sources(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lost_reasons_organization_id_id_uidx
  ON tenant.crm_lost_reasons(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_tags_organization_id_id_uidx
  ON tenant.crm_tags(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_campaigns_organization_id_id_uidx
  ON tenant.crm_campaigns(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_organization_id_id_uidx
  ON tenant.crm_leads(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_tags_organization_id_id_uidx
  ON tenant.crm_lead_tags(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_scoring_rules_organization_id_id_uidx
  ON tenant.crm_scoring_rules(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_score_history_organization_id_id_uidx
  ON tenant.crm_lead_score_history(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_assignment_rules_organization_id_id_uidx
  ON tenant.crm_assignment_rules(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_round_robin_state_organization_id_id_uidx
  ON tenant.crm_round_robin_state(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunities_organization_id_id_uidx
  ON tenant.crm_opportunities(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunity_stage_history_organization_id_id_uidx
  ON tenant.crm_opportunity_stage_history(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunity_items_organization_id_id_uidx
  ON tenant.crm_opportunity_items(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_competitors_organization_id_id_uidx
  ON tenant.crm_competitors(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunity_competitors_organization_id_id_uidx
  ON tenant.crm_opportunity_competitors(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_activities_organization_id_id_uidx
  ON tenant.crm_activities(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_activity_attendees_organization_id_id_uidx
  ON tenant.crm_activity_attendees(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_notes_organization_id_id_uidx
  ON tenant.crm_notes(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_communications_organization_id_id_uidx
  ON tenant.crm_communications(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_sequences_organization_id_id_uidx
  ON tenant.crm_sequences(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_sequence_steps_organization_id_id_uidx
  ON tenant.crm_sequence_steps(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_sequence_enrollments_organization_id_id_uidx
  ON tenant.crm_sequence_enrollments(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_capture_forms_organization_id_id_uidx
  ON tenant.crm_capture_forms(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_capture_rate_limits_organization_id_id_uidx
  ON tenant.crm_capture_rate_limits(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_campaign_members_organization_id_id_uidx
  ON tenant.crm_campaign_members(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_saved_views_organization_id_id_uidx
  ON tenant.crm_saved_views(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_automation_rules_organization_id_id_uidx
  ON tenant.crm_automation_rules(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_automation_runs_organization_id_id_uidx
  ON tenant.crm_automation_runs(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_conversion_records_organization_id_id_uidx
  ON tenant.crm_conversion_records(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_merge_records_organization_id_id_uidx
  ON tenant.crm_merge_records(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_forecast_targets_organization_id_id_uidx
  ON tenant.crm_forecast_targets(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_integrations_organization_id_id_uidx
  ON tenant.crm_integrations(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_webhook_subscriptions_organization_id_id_uidx
  ON tenant.crm_webhook_subscriptions(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_outbox_events_organization_id_id_uidx
  ON tenant.crm_outbox_events(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_sales_teams_organization_id_id_uidx
  ON tenant.crm_sales_teams(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_sales_team_members_organization_id_id_uidx
  ON tenant.crm_sales_team_members(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_territories_organization_id_id_uidx
  ON tenant.crm_territories(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_territory_assignments_organization_id_id_uidx
  ON tenant.crm_territory_assignments(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_quota_plans_organization_id_id_uidx
  ON tenant.crm_quota_plans(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_forecast_periods_organization_id_id_uidx
  ON tenant.crm_forecast_periods(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_forecast_submissions_organization_id_id_uidx
  ON tenant.crm_forecast_submissions(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_forecast_snapshots_organization_id_id_uidx
  ON tenant.crm_forecast_snapshots(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_account_plans_organization_id_id_uidx
  ON tenant.crm_account_plans(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_account_stakeholders_organization_id_id_uidx
  ON tenant.crm_account_stakeholders(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_playbooks_organization_id_id_uidx
  ON tenant.crm_playbooks(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_playbook_questions_organization_id_id_uidx
  ON tenant.crm_playbook_questions(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_playbook_responses_organization_id_id_uidx
  ON tenant.crm_playbook_responses(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_consent_events_organization_id_id_uidx
  ON tenant.crm_consent_events(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_privacy_requests_organization_id_id_uidx
  ON tenant.crm_privacy_requests(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_data_quality_scores_organization_id_id_uidx
  ON tenant.crm_data_quality_scores(organization_id, id);

-- Add organization-aware foreign keys without rewriting historical migrations.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.exchange_rates'::regclass
      AND conname = 'exchange_rates_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.exchange_rates
      ADD CONSTRAINT exchange_rates_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.exchange_rates VALIDATE CONSTRAINT exchange_rates_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.fiscal_periods'::regclass
      AND conname = 'fiscal_periods_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.fiscal_periods
      ADD CONSTRAINT fiscal_periods_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.fiscal_periods VALIDATE CONSTRAINT fiscal_periods_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.tax_rates'::regclass
      AND conname = 'tax_rates_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.tax_rates
      ADD CONSTRAINT tax_rates_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.tax_rates VALIDATE CONSTRAINT tax_rates_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.tax_rates'::regclass
      AND conname = 'tax_rates_tax_category_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.tax_rates
      ADD CONSTRAINT tax_rates_tax_category_id_organization_fkey
      FOREIGN KEY (organization_id, tax_category_id)
      REFERENCES tenant.tax_categories(organization_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.tax_rates VALIDATE CONSTRAINT tax_rates_tax_category_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.payment_term_lines'::regclass
      AND conname = 'payment_term_lines_payment_term_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.payment_term_lines
      ADD CONSTRAINT payment_term_lines_payment_term_id_organization_fkey
      FOREIGN KEY (organization_id, payment_term_id)
      REFERENCES tenant.payment_terms(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.payment_term_lines VALIDATE CONSTRAINT payment_term_lines_payment_term_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.business_parties'::regclass
      AND conname = 'business_parties_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.business_parties
      ADD CONSTRAINT business_parties_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.business_parties VALIDATE CONSTRAINT business_parties_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.business_parties'::regclass
      AND conname = 'business_parties_payment_term_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.business_parties
      ADD CONSTRAINT business_parties_payment_term_id_organization_fkey
      FOREIGN KEY (organization_id, payment_term_id)
      REFERENCES tenant.payment_terms(organization_id, id) ON DELETE SET NULL (payment_term_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.business_parties VALIDATE CONSTRAINT business_parties_payment_term_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.contacts'::regclass
      AND conname = 'contacts_party_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.contacts
      ADD CONSTRAINT contacts_party_id_organization_fkey
      FOREIGN KEY (organization_id, party_id)
      REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.contacts VALIDATE CONSTRAINT contacts_party_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.addresses'::regclass
      AND conname = 'addresses_party_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.addresses
      ADD CONSTRAINT addresses_party_id_organization_fkey
      FOREIGN KEY (organization_id, party_id)
      REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.addresses VALIDATE CONSTRAINT addresses_party_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.item_groups'::regclass
      AND conname = 'item_groups_parent_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.item_groups
      ADD CONSTRAINT item_groups_parent_id_organization_fkey
      FOREIGN KEY (organization_id, parent_id)
      REFERENCES tenant.item_groups(organization_id, id) ON DELETE SET NULL (parent_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.item_groups VALIDATE CONSTRAINT item_groups_parent_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.items'::regclass
      AND conname = 'items_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.items
      ADD CONSTRAINT items_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.items VALIDATE CONSTRAINT items_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.items'::regclass
      AND conname = 'items_group_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.items
      ADD CONSTRAINT items_group_id_organization_fkey
      FOREIGN KEY (organization_id, group_id)
      REFERENCES tenant.item_groups(organization_id, id) ON DELETE SET NULL (group_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.items VALIDATE CONSTRAINT items_group_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.items'::regclass
      AND conname = 'items_uom_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.items
      ADD CONSTRAINT items_uom_id_organization_fkey
      FOREIGN KEY (organization_id, uom_id)
      REFERENCES tenant.units_of_measure(organization_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.items VALIDATE CONSTRAINT items_uom_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.items'::regclass
      AND conname = 'items_tax_category_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.items
      ADD CONSTRAINT items_tax_category_id_organization_fkey
      FOREIGN KEY (organization_id, tax_category_id)
      REFERENCES tenant.tax_categories(organization_id, id) ON DELETE SET NULL (tax_category_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.items VALIDATE CONSTRAINT items_tax_category_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.item_uom_conversions'::regclass
      AND conname = 'item_uom_conversions_item_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.item_uom_conversions
      ADD CONSTRAINT item_uom_conversions_item_id_organization_fkey
      FOREIGN KEY (organization_id, item_id)
      REFERENCES tenant.items(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.item_uom_conversions VALIDATE CONSTRAINT item_uom_conversions_item_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.item_uom_conversions'::regclass
      AND conname = 'item_uom_conversions_from_uom_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.item_uom_conversions
      ADD CONSTRAINT item_uom_conversions_from_uom_id_organization_fkey
      FOREIGN KEY (organization_id, from_uom_id)
      REFERENCES tenant.units_of_measure(organization_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.item_uom_conversions VALIDATE CONSTRAINT item_uom_conversions_from_uom_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.item_uom_conversions'::regclass
      AND conname = 'item_uom_conversions_to_uom_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.item_uom_conversions
      ADD CONSTRAINT item_uom_conversions_to_uom_id_organization_fkey
      FOREIGN KEY (organization_id, to_uom_id)
      REFERENCES tenant.units_of_measure(organization_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.item_uom_conversions VALIDATE CONSTRAINT item_uom_conversions_to_uom_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.warehouses'::regclass
      AND conname = 'warehouses_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.warehouses
      ADD CONSTRAINT warehouses_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.warehouses VALIDATE CONSTRAINT warehouses_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.warehouses'::regclass
      AND conname = 'warehouses_branch_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.warehouses
      ADD CONSTRAINT warehouses_branch_id_organization_fkey
      FOREIGN KEY (organization_id, branch_id)
      REFERENCES public.branches(organization_id, id) ON DELETE SET NULL (branch_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.warehouses VALIDATE CONSTRAINT warehouses_branch_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.warehouse_locations'::regclass
      AND conname = 'warehouse_locations_warehouse_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.warehouse_locations
      ADD CONSTRAINT warehouse_locations_warehouse_id_organization_fkey
      FOREIGN KEY (organization_id, warehouse_id)
      REFERENCES tenant.warehouses(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.warehouse_locations VALIDATE CONSTRAINT warehouse_locations_warehouse_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.warehouse_locations'::regclass
      AND conname = 'warehouse_locations_parent_location_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.warehouse_locations
      ADD CONSTRAINT warehouse_locations_parent_location_id_organization_fkey
      FOREIGN KEY (organization_id, parent_location_id)
      REFERENCES tenant.warehouse_locations(organization_id, id) ON DELETE SET NULL (parent_location_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.warehouse_locations VALIDATE CONSTRAINT warehouse_locations_parent_location_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.price_list_items'::regclass
      AND conname = 'price_list_items_price_list_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.price_list_items
      ADD CONSTRAINT price_list_items_price_list_id_organization_fkey
      FOREIGN KEY (organization_id, price_list_id)
      REFERENCES tenant.price_lists(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.price_list_items VALIDATE CONSTRAINT price_list_items_price_list_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.price_list_items'::regclass
      AND conname = 'price_list_items_item_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.price_list_items
      ADD CONSTRAINT price_list_items_item_id_organization_fkey
      FOREIGN KEY (organization_id, item_id)
      REFERENCES tenant.items(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.price_list_items VALIDATE CONSTRAINT price_list_items_item_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.price_list_items'::regclass
      AND conname = 'price_list_items_uom_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.price_list_items
      ADD CONSTRAINT price_list_items_uom_id_organization_fkey
      FOREIGN KEY (organization_id, uom_id)
      REFERENCES tenant.units_of_measure(organization_id, id) ON DELETE SET NULL (uom_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.price_list_items VALIDATE CONSTRAINT price_list_items_uom_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_pipelines'::regclass
      AND conname = 'crm_pipelines_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_pipelines
      ADD CONSTRAINT crm_pipelines_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_pipelines VALIDATE CONSTRAINT crm_pipelines_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_pipeline_stages'::regclass
      AND conname = 'crm_pipeline_stages_pipeline_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_pipeline_stages
      ADD CONSTRAINT crm_pipeline_stages_pipeline_id_organization_fkey
      FOREIGN KEY (organization_id, pipeline_id)
      REFERENCES tenant.crm_pipelines(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_pipeline_stages VALIDATE CONSTRAINT crm_pipeline_stages_pipeline_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_campaigns'::regclass
      AND conname = 'crm_campaigns_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_campaigns
      ADD CONSTRAINT crm_campaigns_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_campaigns VALIDATE CONSTRAINT crm_campaigns_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass
      AND conname = 'crm_leads_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_leads VALIDATE CONSTRAINT crm_leads_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass
      AND conname = 'crm_leads_branch_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_branch_id_organization_fkey
      FOREIGN KEY (organization_id, branch_id)
      REFERENCES public.branches(organization_id, id) ON DELETE SET NULL (branch_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_leads VALIDATE CONSTRAINT crm_leads_branch_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass
      AND conname = 'crm_leads_source_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_source_id_organization_fkey
      FOREIGN KEY (organization_id, source_id)
      REFERENCES tenant.crm_lead_sources(organization_id, id) ON DELETE SET NULL (source_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_leads VALIDATE CONSTRAINT crm_leads_source_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass
      AND conname = 'crm_leads_campaign_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_campaign_id_organization_fkey
      FOREIGN KEY (organization_id, campaign_id)
      REFERENCES tenant.crm_campaigns(organization_id, id) ON DELETE SET NULL (campaign_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_leads VALIDATE CONSTRAINT crm_leads_campaign_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass
      AND conname = 'crm_leads_converted_party_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_converted_party_id_organization_fkey
      FOREIGN KEY (organization_id, converted_party_id)
      REFERENCES tenant.business_parties(organization_id, id) ON DELETE SET NULL (converted_party_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_leads VALIDATE CONSTRAINT crm_leads_converted_party_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass
      AND conname = 'crm_leads_converted_contact_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_converted_contact_id_organization_fkey
      FOREIGN KEY (organization_id, converted_contact_id)
      REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL (converted_contact_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_leads VALIDATE CONSTRAINT crm_leads_converted_contact_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_lead_tags'::regclass
      AND conname = 'crm_lead_tags_lead_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_lead_tags
      ADD CONSTRAINT crm_lead_tags_lead_id_organization_fkey
      FOREIGN KEY (organization_id, lead_id)
      REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_lead_tags VALIDATE CONSTRAINT crm_lead_tags_lead_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_lead_tags'::regclass
      AND conname = 'crm_lead_tags_tag_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_lead_tags
      ADD CONSTRAINT crm_lead_tags_tag_id_organization_fkey
      FOREIGN KEY (organization_id, tag_id)
      REFERENCES tenant.crm_tags(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_lead_tags VALIDATE CONSTRAINT crm_lead_tags_tag_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_lead_score_history'::regclass
      AND conname = 'crm_lead_score_history_lead_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_lead_score_history
      ADD CONSTRAINT crm_lead_score_history_lead_id_organization_fkey
      FOREIGN KEY (organization_id, lead_id)
      REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_lead_score_history VALIDATE CONSTRAINT crm_lead_score_history_lead_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_lead_score_history'::regclass
      AND conname = 'crm_lead_score_history_rule_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_lead_score_history
      ADD CONSTRAINT crm_lead_score_history_rule_id_organization_fkey
      FOREIGN KEY (organization_id, rule_id)
      REFERENCES tenant.crm_scoring_rules(organization_id, id) ON DELETE SET NULL (rule_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_lead_score_history VALIDATE CONSTRAINT crm_lead_score_history_rule_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_round_robin_state'::regclass
      AND conname = 'crm_round_robin_state_assignment_rule_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_round_robin_state
      ADD CONSTRAINT crm_round_robin_state_assignment_rule_id_organization_fkey
      FOREIGN KEY (organization_id, assignment_rule_id)
      REFERENCES tenant.crm_assignment_rules(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_round_robin_state VALIDATE CONSTRAINT crm_round_robin_state_assignment_rule_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities VALIDATE CONSTRAINT crm_opportunities_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_branch_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_branch_id_organization_fkey
      FOREIGN KEY (organization_id, branch_id)
      REFERENCES public.branches(organization_id, id) ON DELETE SET NULL (branch_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities VALIDATE CONSTRAINT crm_opportunities_branch_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_pipeline_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_pipeline_id_organization_fkey
      FOREIGN KEY (organization_id, pipeline_id)
      REFERENCES tenant.crm_pipelines(organization_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities VALIDATE CONSTRAINT crm_opportunities_pipeline_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_stage_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_stage_id_organization_fkey
      FOREIGN KEY (organization_id, stage_id)
      REFERENCES tenant.crm_pipeline_stages(organization_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities VALIDATE CONSTRAINT crm_opportunities_stage_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_lead_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_lead_id_organization_fkey
      FOREIGN KEY (organization_id, lead_id)
      REFERENCES tenant.crm_leads(organization_id, id) ON DELETE SET NULL (lead_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities VALIDATE CONSTRAINT crm_opportunities_lead_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_party_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_party_id_organization_fkey
      FOREIGN KEY (organization_id, party_id)
      REFERENCES tenant.business_parties(organization_id, id) ON DELETE SET NULL (party_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities VALIDATE CONSTRAINT crm_opportunities_party_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_contact_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_contact_id_organization_fkey
      FOREIGN KEY (organization_id, contact_id)
      REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL (contact_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities VALIDATE CONSTRAINT crm_opportunities_contact_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_campaign_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_campaign_id_organization_fkey
      FOREIGN KEY (organization_id, campaign_id)
      REFERENCES tenant.crm_campaigns(organization_id, id) ON DELETE SET NULL (campaign_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities VALIDATE CONSTRAINT crm_opportunities_campaign_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_source_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_source_id_organization_fkey
      FOREIGN KEY (organization_id, source_id)
      REFERENCES tenant.crm_lead_sources(organization_id, id) ON DELETE SET NULL (source_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities VALIDATE CONSTRAINT crm_opportunities_source_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunities'::regclass
      AND conname = 'crm_opportunities_lost_reason_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_lost_reason_id_organization_fkey
      FOREIGN KEY (organization_id, lost_reason_id)
      REFERENCES tenant.crm_lost_reasons(organization_id, id) ON DELETE SET NULL (lost_reason_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities VALIDATE CONSTRAINT crm_opportunities_lost_reason_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunity_stage_history'::regclass
      AND conname = 'crm_opportunity_stage_history_opportunity_id_organization_fk'
  ) THEN
    ALTER TABLE tenant.crm_opportunity_stage_history
      ADD CONSTRAINT crm_opportunity_stage_history_opportunity_id_organization_fk
      FOREIGN KEY (organization_id, opportunity_id)
      REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunity_stage_history VALIDATE CONSTRAINT crm_opportunity_stage_history_opportunity_id_organization_fk;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunity_stage_history'::regclass
      AND conname = 'crm_opportunity_stage_history_from_stage_id_organization_fke'
  ) THEN
    ALTER TABLE tenant.crm_opportunity_stage_history
      ADD CONSTRAINT crm_opportunity_stage_history_from_stage_id_organization_fke
      FOREIGN KEY (organization_id, from_stage_id)
      REFERENCES tenant.crm_pipeline_stages(organization_id, id) ON DELETE SET NULL (from_stage_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunity_stage_history VALIDATE CONSTRAINT crm_opportunity_stage_history_from_stage_id_organization_fke;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunity_stage_history'::regclass
      AND conname = 'crm_opportunity_stage_history_to_stage_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunity_stage_history
      ADD CONSTRAINT crm_opportunity_stage_history_to_stage_id_organization_fkey
      FOREIGN KEY (organization_id, to_stage_id)
      REFERENCES tenant.crm_pipeline_stages(organization_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunity_stage_history VALIDATE CONSTRAINT crm_opportunity_stage_history_to_stage_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunity_items'::regclass
      AND conname = 'crm_opportunity_items_opportunity_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunity_items
      ADD CONSTRAINT crm_opportunity_items_opportunity_id_organization_fkey
      FOREIGN KEY (organization_id, opportunity_id)
      REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunity_items VALIDATE CONSTRAINT crm_opportunity_items_opportunity_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunity_items'::regclass
      AND conname = 'crm_opportunity_items_item_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunity_items
      ADD CONSTRAINT crm_opportunity_items_item_id_organization_fkey
      FOREIGN KEY (organization_id, item_id)
      REFERENCES tenant.items(organization_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunity_items VALIDATE CONSTRAINT crm_opportunity_items_item_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunity_items'::regclass
      AND conname = 'crm_opportunity_items_price_list_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunity_items
      ADD CONSTRAINT crm_opportunity_items_price_list_id_organization_fkey
      FOREIGN KEY (organization_id, price_list_id)
      REFERENCES tenant.price_lists(organization_id, id) ON DELETE SET NULL (price_list_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunity_items VALIDATE CONSTRAINT crm_opportunity_items_price_list_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunity_competitors'::regclass
      AND conname = 'crm_opportunity_competitors_opportunity_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunity_competitors
      ADD CONSTRAINT crm_opportunity_competitors_opportunity_id_organization_fkey
      FOREIGN KEY (organization_id, opportunity_id)
      REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunity_competitors VALIDATE CONSTRAINT crm_opportunity_competitors_opportunity_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_opportunity_competitors'::regclass
      AND conname = 'crm_opportunity_competitors_competitor_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunity_competitors
      ADD CONSTRAINT crm_opportunity_competitors_competitor_id_organization_fkey
      FOREIGN KEY (organization_id, competitor_id)
      REFERENCES tenant.crm_competitors(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunity_competitors VALIDATE CONSTRAINT crm_opportunity_competitors_competitor_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_activities'::regclass
      AND conname = 'crm_activities_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_activities
      ADD CONSTRAINT crm_activities_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_activities VALIDATE CONSTRAINT crm_activities_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_activities'::regclass
      AND conname = 'crm_activities_branch_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_activities
      ADD CONSTRAINT crm_activities_branch_id_organization_fkey
      FOREIGN KEY (organization_id, branch_id)
      REFERENCES public.branches(organization_id, id) ON DELETE SET NULL (branch_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_activities VALIDATE CONSTRAINT crm_activities_branch_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_activity_attendees'::regclass
      AND conname = 'crm_activity_attendees_activity_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_activity_attendees
      ADD CONSTRAINT crm_activity_attendees_activity_id_organization_fkey
      FOREIGN KEY (organization_id, activity_id)
      REFERENCES tenant.crm_activities(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_activity_attendees VALIDATE CONSTRAINT crm_activity_attendees_activity_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_activity_attendees'::regclass
      AND conname = 'crm_activity_attendees_contact_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_activity_attendees
      ADD CONSTRAINT crm_activity_attendees_contact_id_organization_fkey
      FOREIGN KEY (organization_id, contact_id)
      REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL (contact_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_activity_attendees VALIDATE CONSTRAINT crm_activity_attendees_contact_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_communications'::regclass
      AND conname = 'crm_communications_lead_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_communications
      ADD CONSTRAINT crm_communications_lead_id_organization_fkey
      FOREIGN KEY (organization_id, lead_id)
      REFERENCES tenant.crm_leads(organization_id, id) ON DELETE SET NULL (lead_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_communications VALIDATE CONSTRAINT crm_communications_lead_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_communications'::regclass
      AND conname = 'crm_communications_opportunity_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_communications
      ADD CONSTRAINT crm_communications_opportunity_id_organization_fkey
      FOREIGN KEY (organization_id, opportunity_id)
      REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE SET NULL (opportunity_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_communications VALIDATE CONSTRAINT crm_communications_opportunity_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_communications'::regclass
      AND conname = 'crm_communications_party_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_communications
      ADD CONSTRAINT crm_communications_party_id_organization_fkey
      FOREIGN KEY (organization_id, party_id)
      REFERENCES tenant.business_parties(organization_id, id) ON DELETE SET NULL (party_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_communications VALIDATE CONSTRAINT crm_communications_party_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_communications'::regclass
      AND conname = 'crm_communications_contact_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_communications
      ADD CONSTRAINT crm_communications_contact_id_organization_fkey
      FOREIGN KEY (organization_id, contact_id)
      REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL (contact_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_communications VALIDATE CONSTRAINT crm_communications_contact_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_sequence_steps'::regclass
      AND conname = 'crm_sequence_steps_sequence_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_sequence_steps
      ADD CONSTRAINT crm_sequence_steps_sequence_id_organization_fkey
      FOREIGN KEY (organization_id, sequence_id)
      REFERENCES tenant.crm_sequences(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_sequence_steps VALIDATE CONSTRAINT crm_sequence_steps_sequence_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_sequence_enrollments'::regclass
      AND conname = 'crm_sequence_enrollments_sequence_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_sequence_enrollments
      ADD CONSTRAINT crm_sequence_enrollments_sequence_id_organization_fkey
      FOREIGN KEY (organization_id, sequence_id)
      REFERENCES tenant.crm_sequences(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_sequence_enrollments VALIDATE CONSTRAINT crm_sequence_enrollments_sequence_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_sequence_enrollments'::regclass
      AND conname = 'crm_sequence_enrollments_lead_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_sequence_enrollments
      ADD CONSTRAINT crm_sequence_enrollments_lead_id_organization_fkey
      FOREIGN KEY (organization_id, lead_id)
      REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_sequence_enrollments VALIDATE CONSTRAINT crm_sequence_enrollments_lead_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_sequence_enrollments'::regclass
      AND conname = 'crm_sequence_enrollments_contact_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_sequence_enrollments
      ADD CONSTRAINT crm_sequence_enrollments_contact_id_organization_fkey
      FOREIGN KEY (organization_id, contact_id)
      REFERENCES tenant.contacts(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_sequence_enrollments VALIDATE CONSTRAINT crm_sequence_enrollments_contact_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_sequence_enrollments'::regclass
      AND conname = 'crm_sequence_enrollments_opportunity_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_sequence_enrollments
      ADD CONSTRAINT crm_sequence_enrollments_opportunity_id_organization_fkey
      FOREIGN KEY (organization_id, opportunity_id)
      REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_sequence_enrollments VALIDATE CONSTRAINT crm_sequence_enrollments_opportunity_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_capture_forms'::regclass
      AND conname = 'crm_capture_forms_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_capture_forms
      ADD CONSTRAINT crm_capture_forms_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_capture_forms VALIDATE CONSTRAINT crm_capture_forms_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_capture_forms'::regclass
      AND conname = 'crm_capture_forms_branch_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_capture_forms
      ADD CONSTRAINT crm_capture_forms_branch_id_organization_fkey
      FOREIGN KEY (organization_id, branch_id)
      REFERENCES public.branches(organization_id, id) ON DELETE SET NULL (branch_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_capture_forms VALIDATE CONSTRAINT crm_capture_forms_branch_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_capture_forms'::regclass
      AND conname = 'crm_capture_forms_source_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_capture_forms
      ADD CONSTRAINT crm_capture_forms_source_id_organization_fkey
      FOREIGN KEY (organization_id, source_id)
      REFERENCES tenant.crm_lead_sources(organization_id, id) ON DELETE SET NULL (source_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_capture_forms VALIDATE CONSTRAINT crm_capture_forms_source_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_capture_forms'::regclass
      AND conname = 'crm_capture_forms_campaign_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_capture_forms
      ADD CONSTRAINT crm_capture_forms_campaign_id_organization_fkey
      FOREIGN KEY (organization_id, campaign_id)
      REFERENCES tenant.crm_campaigns(organization_id, id) ON DELETE SET NULL (campaign_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_capture_forms VALIDATE CONSTRAINT crm_capture_forms_campaign_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_capture_rate_limits'::regclass
      AND conname = 'crm_capture_rate_limits_form_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_capture_rate_limits
      ADD CONSTRAINT crm_capture_rate_limits_form_id_organization_fkey
      FOREIGN KEY (organization_id, form_id)
      REFERENCES tenant.crm_capture_forms(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_capture_rate_limits VALIDATE CONSTRAINT crm_capture_rate_limits_form_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_campaign_members'::regclass
      AND conname = 'crm_campaign_members_campaign_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_campaign_members
      ADD CONSTRAINT crm_campaign_members_campaign_id_organization_fkey
      FOREIGN KEY (organization_id, campaign_id)
      REFERENCES tenant.crm_campaigns(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_campaign_members VALIDATE CONSTRAINT crm_campaign_members_campaign_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_campaign_members'::regclass
      AND conname = 'crm_campaign_members_lead_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_campaign_members
      ADD CONSTRAINT crm_campaign_members_lead_id_organization_fkey
      FOREIGN KEY (organization_id, lead_id)
      REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_campaign_members VALIDATE CONSTRAINT crm_campaign_members_lead_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_campaign_members'::regclass
      AND conname = 'crm_campaign_members_contact_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_campaign_members
      ADD CONSTRAINT crm_campaign_members_contact_id_organization_fkey
      FOREIGN KEY (organization_id, contact_id)
      REFERENCES tenant.contacts(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_campaign_members VALIDATE CONSTRAINT crm_campaign_members_contact_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_campaign_members'::regclass
      AND conname = 'crm_campaign_members_party_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_campaign_members
      ADD CONSTRAINT crm_campaign_members_party_id_organization_fkey
      FOREIGN KEY (organization_id, party_id)
      REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_campaign_members VALIDATE CONSTRAINT crm_campaign_members_party_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_automation_runs'::regclass
      AND conname = 'crm_automation_runs_rule_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_automation_runs
      ADD CONSTRAINT crm_automation_runs_rule_id_organization_fkey
      FOREIGN KEY (organization_id, rule_id)
      REFERENCES tenant.crm_automation_rules(organization_id, id) ON DELETE SET NULL (rule_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_automation_runs VALIDATE CONSTRAINT crm_automation_runs_rule_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_conversion_records'::regclass
      AND conname = 'crm_conversion_records_lead_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_conversion_records
      ADD CONSTRAINT crm_conversion_records_lead_id_organization_fkey
      FOREIGN KEY (organization_id, lead_id)
      REFERENCES tenant.crm_leads(organization_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_conversion_records VALIDATE CONSTRAINT crm_conversion_records_lead_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_conversion_records'::regclass
      AND conname = 'crm_conversion_records_party_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_conversion_records
      ADD CONSTRAINT crm_conversion_records_party_id_organization_fkey
      FOREIGN KEY (organization_id, party_id)
      REFERENCES tenant.business_parties(organization_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_conversion_records VALIDATE CONSTRAINT crm_conversion_records_party_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_conversion_records'::regclass
      AND conname = 'crm_conversion_records_contact_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_conversion_records
      ADD CONSTRAINT crm_conversion_records_contact_id_organization_fkey
      FOREIGN KEY (organization_id, contact_id)
      REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL (contact_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_conversion_records VALIDATE CONSTRAINT crm_conversion_records_contact_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_conversion_records'::regclass
      AND conname = 'crm_conversion_records_opportunity_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_conversion_records
      ADD CONSTRAINT crm_conversion_records_opportunity_id_organization_fkey
      FOREIGN KEY (organization_id, opportunity_id)
      REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE SET NULL (opportunity_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_conversion_records VALIDATE CONSTRAINT crm_conversion_records_opportunity_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_forecast_targets'::regclass
      AND conname = 'crm_forecast_targets_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_forecast_targets
      ADD CONSTRAINT crm_forecast_targets_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_forecast_targets VALIDATE CONSTRAINT crm_forecast_targets_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_sales_teams'::regclass
      AND conname = 'crm_sales_teams_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_sales_teams
      ADD CONSTRAINT crm_sales_teams_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_sales_teams VALIDATE CONSTRAINT crm_sales_teams_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_sales_teams'::regclass
      AND conname = 'crm_sales_teams_parent_team_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_sales_teams
      ADD CONSTRAINT crm_sales_teams_parent_team_id_organization_fkey
      FOREIGN KEY (organization_id, parent_team_id)
      REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE SET NULL (parent_team_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_sales_teams VALIDATE CONSTRAINT crm_sales_teams_parent_team_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_sales_teams'::regclass
      AND conname = 'crm_sales_teams_default_pipeline_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_sales_teams
      ADD CONSTRAINT crm_sales_teams_default_pipeline_id_organization_fkey
      FOREIGN KEY (organization_id, default_pipeline_id)
      REFERENCES tenant.crm_pipelines(organization_id, id) ON DELETE SET NULL (default_pipeline_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_sales_teams VALIDATE CONSTRAINT crm_sales_teams_default_pipeline_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_sales_team_members'::regclass
      AND conname = 'crm_sales_team_members_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_sales_team_members
      ADD CONSTRAINT crm_sales_team_members_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_sales_team_members VALIDATE CONSTRAINT crm_sales_team_members_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_sales_team_members'::regclass
      AND conname = 'crm_sales_team_members_team_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_sales_team_members
      ADD CONSTRAINT crm_sales_team_members_team_id_organization_fkey
      FOREIGN KEY (organization_id, team_id)
      REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_sales_team_members VALIDATE CONSTRAINT crm_sales_team_members_team_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_territories'::regclass
      AND conname = 'crm_territories_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_territories
      ADD CONSTRAINT crm_territories_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_territories VALIDATE CONSTRAINT crm_territories_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_territories'::regclass
      AND conname = 'crm_territories_parent_territory_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_territories
      ADD CONSTRAINT crm_territories_parent_territory_id_organization_fkey
      FOREIGN KEY (organization_id, parent_territory_id)
      REFERENCES tenant.crm_territories(organization_id, id) ON DELETE SET NULL (parent_territory_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_territories VALIDATE CONSTRAINT crm_territories_parent_territory_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_territory_assignments'::regclass
      AND conname = 'crm_territory_assignments_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_territory_assignments
      ADD CONSTRAINT crm_territory_assignments_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_territory_assignments VALIDATE CONSTRAINT crm_territory_assignments_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_territory_assignments'::regclass
      AND conname = 'crm_territory_assignments_territory_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_territory_assignments
      ADD CONSTRAINT crm_territory_assignments_territory_id_organization_fkey
      FOREIGN KEY (organization_id, territory_id)
      REFERENCES tenant.crm_territories(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_territory_assignments VALIDATE CONSTRAINT crm_territory_assignments_territory_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_quota_plans'::regclass
      AND conname = 'crm_quota_plans_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_quota_plans
      ADD CONSTRAINT crm_quota_plans_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_quota_plans VALIDATE CONSTRAINT crm_quota_plans_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_quota_plans'::regclass
      AND conname = 'crm_quota_plans_team_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_quota_plans
      ADD CONSTRAINT crm_quota_plans_team_id_organization_fkey
      FOREIGN KEY (organization_id, team_id)
      REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_quota_plans VALIDATE CONSTRAINT crm_quota_plans_team_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_quota_plans'::regclass
      AND conname = 'crm_quota_plans_territory_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_quota_plans
      ADD CONSTRAINT crm_quota_plans_territory_id_organization_fkey
      FOREIGN KEY (organization_id, territory_id)
      REFERENCES tenant.crm_territories(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_quota_plans VALIDATE CONSTRAINT crm_quota_plans_territory_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_forecast_periods'::regclass
      AND conname = 'crm_forecast_periods_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_forecast_periods
      ADD CONSTRAINT crm_forecast_periods_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_forecast_periods VALIDATE CONSTRAINT crm_forecast_periods_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_forecast_submissions'::regclass
      AND conname = 'crm_forecast_submissions_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_forecast_submissions
      ADD CONSTRAINT crm_forecast_submissions_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_forecast_submissions VALIDATE CONSTRAINT crm_forecast_submissions_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_forecast_submissions'::regclass
      AND conname = 'crm_forecast_submissions_period_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_forecast_submissions
      ADD CONSTRAINT crm_forecast_submissions_period_id_organization_fkey
      FOREIGN KEY (organization_id, period_id)
      REFERENCES tenant.crm_forecast_periods(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_forecast_submissions VALIDATE CONSTRAINT crm_forecast_submissions_period_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_forecast_submissions'::regclass
      AND conname = 'crm_forecast_submissions_team_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_forecast_submissions
      ADD CONSTRAINT crm_forecast_submissions_team_id_organization_fkey
      FOREIGN KEY (organization_id, team_id)
      REFERENCES tenant.crm_sales_teams(organization_id, id) ON DELETE SET NULL (team_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_forecast_submissions VALIDATE CONSTRAINT crm_forecast_submissions_team_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_forecast_submissions'::regclass
      AND conname = 'crm_forecast_submissions_territory_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_forecast_submissions
      ADD CONSTRAINT crm_forecast_submissions_territory_id_organization_fkey
      FOREIGN KEY (organization_id, territory_id)
      REFERENCES tenant.crm_territories(organization_id, id) ON DELETE SET NULL (territory_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_forecast_submissions VALIDATE CONSTRAINT crm_forecast_submissions_territory_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_forecast_snapshots'::regclass
      AND conname = 'crm_forecast_snapshots_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_forecast_snapshots
      ADD CONSTRAINT crm_forecast_snapshots_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_forecast_snapshots VALIDATE CONSTRAINT crm_forecast_snapshots_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_forecast_snapshots'::regclass
      AND conname = 'crm_forecast_snapshots_period_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_forecast_snapshots
      ADD CONSTRAINT crm_forecast_snapshots_period_id_organization_fkey
      FOREIGN KEY (organization_id, period_id)
      REFERENCES tenant.crm_forecast_periods(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_forecast_snapshots VALIDATE CONSTRAINT crm_forecast_snapshots_period_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_forecast_snapshots'::regclass
      AND conname = 'crm_forecast_snapshots_submission_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_forecast_snapshots
      ADD CONSTRAINT crm_forecast_snapshots_submission_id_organization_fkey
      FOREIGN KEY (organization_id, submission_id)
      REFERENCES tenant.crm_forecast_submissions(organization_id, id) ON DELETE SET NULL (submission_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_forecast_snapshots VALIDATE CONSTRAINT crm_forecast_snapshots_submission_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_account_plans'::regclass
      AND conname = 'crm_account_plans_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_account_plans
      ADD CONSTRAINT crm_account_plans_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_account_plans VALIDATE CONSTRAINT crm_account_plans_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_account_plans'::regclass
      AND conname = 'crm_account_plans_party_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_account_plans
      ADD CONSTRAINT crm_account_plans_party_id_organization_fkey
      FOREIGN KEY (organization_id, party_id)
      REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_account_plans VALIDATE CONSTRAINT crm_account_plans_party_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_account_stakeholders'::regclass
      AND conname = 'crm_account_stakeholders_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_account_stakeholders
      ADD CONSTRAINT crm_account_stakeholders_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_account_stakeholders VALIDATE CONSTRAINT crm_account_stakeholders_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_account_stakeholders'::regclass
      AND conname = 'crm_account_stakeholders_account_plan_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_account_stakeholders
      ADD CONSTRAINT crm_account_stakeholders_account_plan_id_organization_fkey
      FOREIGN KEY (organization_id, account_plan_id)
      REFERENCES tenant.crm_account_plans(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_account_stakeholders VALIDATE CONSTRAINT crm_account_stakeholders_account_plan_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_account_stakeholders'::regclass
      AND conname = 'crm_account_stakeholders_contact_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_account_stakeholders
      ADD CONSTRAINT crm_account_stakeholders_contact_id_organization_fkey
      FOREIGN KEY (organization_id, contact_id)
      REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL (contact_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_account_stakeholders VALIDATE CONSTRAINT crm_account_stakeholders_contact_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_playbooks'::regclass
      AND conname = 'crm_playbooks_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_playbooks
      ADD CONSTRAINT crm_playbooks_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_playbooks VALIDATE CONSTRAINT crm_playbooks_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_playbooks'::regclass
      AND conname = 'crm_playbooks_pipeline_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_playbooks
      ADD CONSTRAINT crm_playbooks_pipeline_id_organization_fkey
      FOREIGN KEY (organization_id, pipeline_id)
      REFERENCES tenant.crm_pipelines(organization_id, id) ON DELETE SET NULL (pipeline_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_playbooks VALIDATE CONSTRAINT crm_playbooks_pipeline_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_playbook_questions'::regclass
      AND conname = 'crm_playbook_questions_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_playbook_questions
      ADD CONSTRAINT crm_playbook_questions_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_playbook_questions VALIDATE CONSTRAINT crm_playbook_questions_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_playbook_questions'::regclass
      AND conname = 'crm_playbook_questions_playbook_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_playbook_questions
      ADD CONSTRAINT crm_playbook_questions_playbook_id_organization_fkey
      FOREIGN KEY (organization_id, playbook_id)
      REFERENCES tenant.crm_playbooks(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_playbook_questions VALIDATE CONSTRAINT crm_playbook_questions_playbook_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_playbook_questions'::regclass
      AND conname = 'crm_playbook_questions_stage_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_playbook_questions
      ADD CONSTRAINT crm_playbook_questions_stage_id_organization_fkey
      FOREIGN KEY (organization_id, stage_id)
      REFERENCES tenant.crm_pipeline_stages(organization_id, id) ON DELETE SET NULL (stage_id)
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_playbook_questions VALIDATE CONSTRAINT crm_playbook_questions_stage_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_playbook_responses'::regclass
      AND conname = 'crm_playbook_responses_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_playbook_responses
      ADD CONSTRAINT crm_playbook_responses_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_playbook_responses VALIDATE CONSTRAINT crm_playbook_responses_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_playbook_responses'::regclass
      AND conname = 'crm_playbook_responses_playbook_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_playbook_responses
      ADD CONSTRAINT crm_playbook_responses_playbook_id_organization_fkey
      FOREIGN KEY (organization_id, playbook_id)
      REFERENCES tenant.crm_playbooks(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_playbook_responses VALIDATE CONSTRAINT crm_playbook_responses_playbook_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_playbook_responses'::regclass
      AND conname = 'crm_playbook_responses_question_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_playbook_responses
      ADD CONSTRAINT crm_playbook_responses_question_id_organization_fkey
      FOREIGN KEY (organization_id, question_id)
      REFERENCES tenant.crm_playbook_questions(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_playbook_responses VALIDATE CONSTRAINT crm_playbook_responses_question_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_playbook_responses'::regclass
      AND conname = 'crm_playbook_responses_opportunity_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_playbook_responses
      ADD CONSTRAINT crm_playbook_responses_opportunity_id_organization_fkey
      FOREIGN KEY (organization_id, opportunity_id)
      REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_playbook_responses VALIDATE CONSTRAINT crm_playbook_responses_opportunity_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_playbook_responses'::regclass
      AND conname = 'crm_playbook_responses_lead_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_playbook_responses
      ADD CONSTRAINT crm_playbook_responses_lead_id_organization_fkey
      FOREIGN KEY (organization_id, lead_id)
      REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_playbook_responses VALIDATE CONSTRAINT crm_playbook_responses_lead_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_consent_events'::regclass
      AND conname = 'crm_consent_events_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_consent_events
      ADD CONSTRAINT crm_consent_events_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_consent_events VALIDATE CONSTRAINT crm_consent_events_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_consent_events'::regclass
      AND conname = 'crm_consent_events_lead_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_consent_events
      ADD CONSTRAINT crm_consent_events_lead_id_organization_fkey
      FOREIGN KEY (organization_id, lead_id)
      REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_consent_events VALIDATE CONSTRAINT crm_consent_events_lead_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_consent_events'::regclass
      AND conname = 'crm_consent_events_contact_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_consent_events
      ADD CONSTRAINT crm_consent_events_contact_id_organization_fkey
      FOREIGN KEY (organization_id, contact_id)
      REFERENCES tenant.contacts(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_consent_events VALIDATE CONSTRAINT crm_consent_events_contact_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_consent_events'::regclass
      AND conname = 'crm_consent_events_party_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_consent_events
      ADD CONSTRAINT crm_consent_events_party_id_organization_fkey
      FOREIGN KEY (organization_id, party_id)
      REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_consent_events VALIDATE CONSTRAINT crm_consent_events_party_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_privacy_requests'::regclass
      AND conname = 'crm_privacy_requests_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_privacy_requests
      ADD CONSTRAINT crm_privacy_requests_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_privacy_requests VALIDATE CONSTRAINT crm_privacy_requests_company_id_organization_fkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_data_quality_scores'::regclass
      AND conname = 'crm_data_quality_scores_company_id_organization_fkey'
  ) THEN
    ALTER TABLE tenant.crm_data_quality_scores
      ADD CONSTRAINT crm_data_quality_scores_company_id_organization_fkey
      FOREIGN KEY (organization_id, company_id)
      REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_data_quality_scores VALIDATE CONSTRAINT crm_data_quality_scores_company_id_organization_fkey;

CREATE OR REPLACE FUNCTION tenant.crm_public_capture_form(form_key text)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  company_id uuid,
  branch_id uuid,
  source_id uuid,
  campaign_id uuid,
  owner_user_id uuid,
  allowed_origins text[],
  required_fields text[],
  success_message text,
  rate_limit_per_hour integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant, public, pg_temp
AS $$
  SELECT
    capture.id,
    capture.organization_id,
    capture.company_id,
    capture.branch_id,
    capture.source_id,
    capture.campaign_id,
    capture.owner_user_id,
    capture.allowed_origins,
    capture.required_fields,
    capture.success_message,
    capture.rate_limit_per_hour
  FROM tenant.crm_capture_forms AS capture
  WHERE capture.public_key = form_key
    AND capture.status = 'active'
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION tenant.crm_public_capture_form(text) FROM PUBLIC;


ALTER TABLE tenant.crm_outbox_events
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS delivery_receipt jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tenant.crm_communications
  DROP CONSTRAINT IF EXISTS crm_communications_status_check;
ALTER TABLE tenant.crm_communications
  ADD CONSTRAINT crm_communications_status_check
  CHECK (status IN (
    'draft', 'queued', 'sent', 'delivered', 'read', 'failed',
    'received', 'logged', 'suppressed'
  ));

COMMIT;
