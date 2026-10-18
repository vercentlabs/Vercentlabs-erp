-- CRM plan, step 1 (the broken items).
--
-- 1.1 Money totals across deals are reported in the organization's base currency, converted with tenant.exchange_rates. The rates
-- get their own screen (Settings → Finance & commercial → Exchange rates) and permissions: seen by whoever sees deals, Sales,
-- Finance or stock valuation; maintained by whoever manages Finance or Sales settings (and administrators).
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('exchange_rates.view', 'View exchange rates', 'Finance', 'See the dated rates that convert other currencies into the base currency.'),
  ('exchange_rates.manage', 'Manage exchange rates', 'Finance', 'Set and deactivate exchange rates.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'exchange_rates.view' FROM public.role_permissions existing
 WHERE existing.permission_key IN ('crm.opportunities.view', 'sales.view', 'accounting.view', 'stock.valuation.view_exchange_rate')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, grant_key FROM public.role_permissions existing
 CROSS JOIN (VALUES ('exchange_rates.view'), ('exchange_rates.manage')) AS keys(grant_key)
 WHERE existing.permission_key IN ('accounting.settings.manage', 'sales.settings.manage')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_key FROM public.roles role
 CROSS JOIN (VALUES ('exchange_rates.view'), ('exchange_rates.manage')) AS keys(grant_key)
 WHERE role.slug IN ('organization_owner', 'system_administrator')
ON CONFLICT DO NOTHING;

-- 1.4 / 2.1 A company's tax identity and terms (GSTIN, PAN, GST treatment, payment terms) are set from CRM on any company — a prospect
-- included — and on a customer while the organization has no Sales; each change is recorded in the company's history.
ALTER TABLE tenant.crm_account_history DROP CONSTRAINT IF EXISTS crm_account_history_event_type_check;
ALTER TABLE tenant.crm_account_history ADD CONSTRAINT crm_account_history_event_type_check CHECK (event_type = ANY (ARRAY[
  'created', 'updated', 'owner_changed', 'team_changed', 'type_changed', 'status_changed', 'parent_changed',
  'address_added', 'address_updated', 'address_removed', 'contact_linked', 'contact_unlinked', 'primary_contact_changed',
  'lead_converted', 'opportunity_created', 'customer_created', 'customer_linked', 'merged', 'deactivated', 'reactivated', 'archived',
  'tax_identity_changed']));

-- 1.5 Consent survives conversion. A contact records the same per-channel consent a lead does (email, SMS, WhatsApp) and can refuse
-- WhatsApp as well as email, calls and SMS; converting a lead carries its consent and its do-not-contact onto the contact, and a
-- follow-up by a channel the person refused is not scheduled.
ALTER TABLE tenant.contacts
  ADD COLUMN IF NOT EXISTS do_not_whatsapp boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_sms boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_whatsapp boolean NOT NULL DEFAULT false;

-- 1.6 CRM-only role templates: CRM Sales Manager and CRM Salesperson carry CRM permissions only (and the shared basics: workspace,
-- notifications, products and tax to read, exchange rates), so a CRM-only business — or one that keeps quoting apart — need not hand out
-- Sales permissions with every CRM role. Added to every organization that has the CRM roles.
INSERT INTO public.roles (id, organization_id, name, slug, description, is_system, status, module_key, template_key, assignable, risk_level, version)
SELECT gen_random_uuid(), organization.id, template.name, template.slug, template.description, true, 'active', 'crm', template.slug, true, template.risk, 1
  FROM public.organizations organization
  CROSS JOIN (VALUES
    ('CRM Sales Manager', 'crm_sales_manager', 'Leads, deals, companies, contacts and follow-ups for their teams, with assignment and the pipeline''s settings — CRM only, no Sales documents.', 'sensitive'),
    ('CRM Salesperson', 'crm_salesperson', 'Their own leads, deals, companies, contacts, tasks and follow-ups — CRM only, no Sales documents.', 'standard')
  ) AS template(name, slug, description, risk)
 WHERE EXISTS (SELECT 1 FROM public.roles existing WHERE existing.organization_id = organization.id AND existing.slug = 'crm_administrator')
ON CONFLICT (organization_id, slug) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('crm_sales_manager', 'workspace.view'),
    ('crm_sales_manager', 'notifications.view'),
    ('crm_sales_manager', 'profile.manage'),
    ('crm_sales_manager', 'business_data.view'),
    ('crm_sales_manager', 'crm.view'),
    ('crm_sales_manager', 'crm.tasks.view'),
    ('crm_sales_manager', 'crm.follow_ups.view'),
    ('crm_sales_manager', 'crm.notes.view'),
    ('crm_sales_manager', 'crm.attachments.view'),
    ('crm_sales_manager', 'crm.attachments.download'),
    ('crm_sales_manager', 'crm.leads.view'),
    ('crm_sales_manager', 'crm.opportunities.view'),
    ('crm_sales_manager', 'crm.accounts.view'),
    ('crm_sales_manager', 'crm.contacts.view'),
    ('crm_sales_manager', 'crm.reports.view'),
    ('crm_sales_manager', 'crm.contacts.view_sensitive'),
    ('crm_sales_manager', 'crm.accounts.view_sensitive'),
    ('crm_sales_manager', 'parties.manage'),
    ('crm_sales_manager', 'crm.leads.create'),
    ('crm_sales_manager', 'crm.leads.edit'),
    ('crm_sales_manager', 'crm.leads.change_stage'),
    ('crm_sales_manager', 'crm.leads.assign'),
    ('crm_sales_manager', 'crm.leads.assign_self'),
    ('crm_sales_manager', 'crm.leads.qualify'),
    ('crm_sales_manager', 'crm.leads.disqualify'),
    ('crm_sales_manager', 'crm.leads.reopen'),
    ('crm_sales_manager', 'crm.leads.convert'),
    ('crm_sales_manager', 'crm.leads.convert_use_existing'),
    ('crm_sales_manager', 'crm.leads.convert_create_account'),
    ('crm_sales_manager', 'crm.leads.convert_create_contact'),
    ('crm_sales_manager', 'crm.leads.merge'),
    ('crm_sales_manager', 'crm.duplicates.override'),
    ('crm_sales_manager', 'crm.duplicates.review'),
    ('crm_sales_manager', 'crm.leads.reassign'),
    ('crm_sales_manager', 'crm.leads.bulk_assign'),
    ('crm_sales_manager', 'crm.leads.override_qualification'),
    ('crm_sales_manager', 'crm.leads.convert_change_owner'),
    ('crm_sales_manager', 'crm.leads.convert_override_duplicate'),
    ('crm_sales_manager', 'crm.leads.delete'),
    ('crm_sales_manager', 'crm.leads.import'),
    ('crm_sales_manager', 'crm.leads.export'),
    ('crm_sales_manager', 'crm.leads.assign_across_teams'),
    ('crm_sales_manager', 'crm.leads.manage_assignment_rules'),
    ('crm_sales_manager', 'crm.leads.manage_stages'),
    ('crm_sales_manager', 'crm.leads.view_sensitive'),
    ('crm_sales_manager', 'crm.saved_views.share'),
    ('crm_sales_manager', 'crm.opportunities.manage'),
    ('crm_sales_manager', 'crm.tasks.create'),
    ('crm_sales_manager', 'crm.tasks.edit'),
    ('crm_sales_manager', 'crm.tasks.complete'),
    ('crm_sales_manager', 'crm.tasks.reopen'),
    ('crm_sales_manager', 'crm.tasks.cancel'),
    ('crm_sales_manager', 'crm.tasks.assign'),
    ('crm_sales_manager', 'crm.follow_ups.create'),
    ('crm_sales_manager', 'crm.follow_ups.edit'),
    ('crm_sales_manager', 'crm.follow_ups.complete'),
    ('crm_sales_manager', 'crm.follow_ups.reschedule'),
    ('crm_sales_manager', 'crm.follow_ups.cancel'),
    ('crm_sales_manager', 'crm.notes.create'),
    ('crm_sales_manager', 'crm.notes.edit_own'),
    ('crm_sales_manager', 'crm.notes.delete_own'),
    ('crm_sales_manager', 'crm.notes.pin'),
    ('crm_sales_manager', 'crm.attachments.upload'),
    ('crm_sales_manager', 'crm.opportunities.create'),
    ('crm_sales_manager', 'crm.opportunities.edit'),
    ('crm_sales_manager', 'crm.opportunities.assign'),
    ('crm_sales_manager', 'crm.opportunities.change_stage'),
    ('crm_sales_manager', 'crm.opportunities.create_quotation'),
    ('crm_sales_manager', 'crm.opportunities.mark_won'),
    ('crm_sales_manager', 'crm.opportunities.mark_lost'),
    ('crm_sales_manager', 'crm.opportunities.change_probability'),
    ('crm_sales_manager', 'crm.opportunities.reassign'),
    ('crm_sales_manager', 'crm.opportunities.reopen'),
    ('crm_sales_manager', 'crm.opportunities.edit_close_reason'),
    ('crm_sales_manager', 'crm.opportunities.delete'),
    ('crm_sales_manager', 'crm.opportunities.export'),
    ('crm_sales_manager', 'crm.opportunities.bulk_update'),
    ('crm_sales_manager', 'crm.tasks.reassign'),
    ('crm_sales_manager', 'crm.tasks.delete'),
    ('crm_sales_manager', 'crm.tasks.view_team'),
    ('crm_sales_manager', 'crm.follow_ups.reassign'),
    ('crm_sales_manager', 'crm.follow_ups.delete'),
    ('crm_sales_manager', 'crm.follow_ups.view_team'),
    ('crm_sales_manager', 'crm.notes.edit_all'),
    ('crm_sales_manager', 'crm.notes.delete_all'),
    ('crm_sales_manager', 'crm.attachments.delete'),
    ('crm_sales_manager', 'crm.activities.manage'),
    ('crm_sales_manager', 'crm.accounts.create'),
    ('crm_sales_manager', 'crm.accounts.edit'),
    ('crm_sales_manager', 'crm.accounts.assign'),
    ('crm_sales_manager', 'crm.accounts.reassign'),
    ('crm_sales_manager', 'crm.accounts.archive'),
    ('crm_sales_manager', 'crm.accounts.delete'),
    ('crm_sales_manager', 'crm.accounts.merge'),
    ('crm_sales_manager', 'crm.accounts.import'),
    ('crm_sales_manager', 'crm.accounts.export'),
    ('crm_sales_manager', 'crm.accounts.create_customer'),
    ('crm_sales_manager', 'crm.contacts.create'),
    ('crm_sales_manager', 'crm.contacts.edit'),
    ('crm_sales_manager', 'crm.contacts.assign'),
    ('crm_sales_manager', 'crm.contacts.reassign'),
    ('crm_sales_manager', 'crm.contacts.archive'),
    ('crm_sales_manager', 'crm.contacts.delete'),
    ('crm_sales_manager', 'crm.contacts.merge'),
    ('crm_sales_manager', 'crm.contacts.import'),
    ('crm_sales_manager', 'crm.contacts.export'),
    ('crm_sales_manager', 'crm.reports.schedule'),
    ('crm_sales_manager', 'products.view'),
    ('crm_sales_manager', 'products.view_sku_history'),
    ('crm_sales_manager', 'tax.view'),
    ('crm_sales_manager', 'exchange_rates.view'),
    ('crm_salesperson', 'workspace.view'),
    ('crm_salesperson', 'notifications.view'),
    ('crm_salesperson', 'profile.manage'),
    ('crm_salesperson', 'business_data.view'),
    ('crm_salesperson', 'crm.view'),
    ('crm_salesperson', 'crm.tasks.view'),
    ('crm_salesperson', 'crm.follow_ups.view'),
    ('crm_salesperson', 'crm.notes.view'),
    ('crm_salesperson', 'crm.attachments.view'),
    ('crm_salesperson', 'crm.attachments.download'),
    ('crm_salesperson', 'crm.leads.view'),
    ('crm_salesperson', 'crm.opportunities.view'),
    ('crm_salesperson', 'crm.accounts.view'),
    ('crm_salesperson', 'crm.contacts.view'),
    ('crm_salesperson', 'crm.reports.view'),
    ('crm_salesperson', 'crm.contacts.view_sensitive'),
    ('crm_salesperson', 'crm.accounts.view_sensitive'),
    ('crm_salesperson', 'parties.manage'),
    ('crm_salesperson', 'crm.leads.create'),
    ('crm_salesperson', 'crm.leads.edit'),
    ('crm_salesperson', 'crm.leads.change_stage'),
    ('crm_salesperson', 'crm.leads.assign'),
    ('crm_salesperson', 'crm.leads.assign_self'),
    ('crm_salesperson', 'crm.leads.qualify'),
    ('crm_salesperson', 'crm.leads.disqualify'),
    ('crm_salesperson', 'crm.leads.reopen'),
    ('crm_salesperson', 'crm.leads.convert'),
    ('crm_salesperson', 'crm.leads.convert_use_existing'),
    ('crm_salesperson', 'crm.leads.convert_create_account'),
    ('crm_salesperson', 'crm.leads.convert_create_contact'),
    ('crm_salesperson', 'crm.leads.view_sensitive'),
    ('crm_salesperson', 'crm.opportunities.manage'),
    ('crm_salesperson', 'crm.tasks.create'),
    ('crm_salesperson', 'crm.tasks.edit'),
    ('crm_salesperson', 'crm.tasks.complete'),
    ('crm_salesperson', 'crm.tasks.reopen'),
    ('crm_salesperson', 'crm.tasks.cancel'),
    ('crm_salesperson', 'crm.tasks.assign'),
    ('crm_salesperson', 'crm.follow_ups.create'),
    ('crm_salesperson', 'crm.follow_ups.edit'),
    ('crm_salesperson', 'crm.follow_ups.complete'),
    ('crm_salesperson', 'crm.follow_ups.reschedule'),
    ('crm_salesperson', 'crm.follow_ups.cancel'),
    ('crm_salesperson', 'crm.notes.create'),
    ('crm_salesperson', 'crm.notes.edit_own'),
    ('crm_salesperson', 'crm.notes.delete_own'),
    ('crm_salesperson', 'crm.notes.pin'),
    ('crm_salesperson', 'crm.attachments.upload'),
    ('crm_salesperson', 'crm.opportunities.create'),
    ('crm_salesperson', 'crm.opportunities.edit'),
    ('crm_salesperson', 'crm.opportunities.assign'),
    ('crm_salesperson', 'crm.opportunities.change_stage'),
    ('crm_salesperson', 'crm.opportunities.create_quotation'),
    ('crm_salesperson', 'crm.opportunities.mark_won'),
    ('crm_salesperson', 'crm.opportunities.mark_lost'),
    ('crm_salesperson', 'crm.opportunities.change_probability'),
    ('crm_salesperson', 'crm.activities.manage'),
    ('crm_salesperson', 'crm.accounts.create'),
    ('crm_salesperson', 'crm.accounts.edit'),
    ('crm_salesperson', 'crm.accounts.assign'),
    ('crm_salesperson', 'crm.accounts.create_customer'),
    ('crm_salesperson', 'crm.contacts.create'),
    ('crm_salesperson', 'crm.contacts.edit'),
    ('crm_salesperson', 'crm.contacts.assign'),
    ('crm_salesperson', 'products.view'),
    ('crm_salesperson', 'products.view_sku_history'),
    ('crm_salesperson', 'tax.view'),
    ('crm_salesperson', 'exchange_rates.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0164_crm_broken_fixes.sql', 'crm-broken-fixes') ON CONFLICT DO NOTHING;
