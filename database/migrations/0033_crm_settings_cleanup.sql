-- CRM Settings cleanup.
--
-- CRM Settings keeps the ten MVP destinations (Lead Management, Opportunity
-- Management, Data Quality, Defaults, Data Management). Playbooks,
-- Territories and Quotas, Sales Coverage, Custom Fields and Custom Record
-- Fields, Meeting Links (public booking) and CRM Data Subject Requests are
-- removed from the product. Sales teams stay, managed in Settings > Teams.
--
-- Their permissions are withdrawn from every role and retired. Their tables
-- and the data in them are left as they are.

DELETE FROM public.access_conflict_rules
 WHERE first_permission_key IN ('crm.playbooks.manage', 'crm.territories.manage', 'crm.coverage.view', 'crm.coverage.assign', 'crm.customization.manage')
    OR second_permission_key IN ('crm.playbooks.manage', 'crm.territories.manage', 'crm.coverage.view', 'crm.coverage.assign', 'crm.customization.manage');

DELETE FROM public.role_permissions
 WHERE permission_key IN ('crm.playbooks.manage', 'crm.territories.manage', 'crm.coverage.view', 'crm.coverage.assign', 'crm.customization.manage');

DELETE FROM public.permissions
 WHERE key IN ('crm.playbooks.manage', 'crm.territories.manage', 'crm.coverage.view', 'crm.coverage.assign', 'crm.customization.manage');

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0033_crm_settings_cleanup.sql', 'crm-settings-cleanup');
