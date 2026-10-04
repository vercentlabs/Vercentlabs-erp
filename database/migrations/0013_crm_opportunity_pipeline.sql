-- CRM Opportunity Pipeline: the stage board over opportunities.
--
--   1. Indexes — the board reads the open deals of a stage, an owner or a team
--   2. Permissions — change probability, bulk update, configure the stages
--
-- The pipeline is a view over opportunities and adds no table of its own:
-- the stages, their default probabilities and the stage history are already
-- there. Nothing is changed or removed.
--
-- Run once, after 0012_crm_opportunities.sql.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 1. indexes

CREATE INDEX crm_opportunities_board_stage_idx ON tenant.crm_opportunities (organization_id, stage_id, expected_close_date) WHERE status = 'open';
CREATE INDEX crm_opportunities_board_owner_idx ON tenant.crm_opportunities (organization_id, owner_user_id) WHERE status = 'open';
-- the next planned activity of a deal, and "no next activity"
CREATE INDEX crm_activities_open_by_record_idx ON tenant.crm_activities (organization_id, entity_type, entity_id, due_at)
  WHERE status = ANY (ARRAY['planned', 'in_progress', 'overdue']);

-- ============================================================ 2. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.opportunities.change_probability', 'Change opportunity probability', 'CRM', 'Set an opportunity''s probability instead of the default of its stage.'),
  ('crm.opportunities.bulk_update', 'Update opportunities in bulk', 'CRM', 'Change the stage or the owner of several opportunities in one action.'),
  ('crm.pipeline.manage_stages', 'Configure pipeline stages', 'CRM', 'Rename, reorder, add and deactivate the sales stages, and set their default probability.')
ON CONFLICT (key) DO NOTHING;

-- Workspaces that already exist. Whoever can edit opportunities can set a probability.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'crm.opportunities.change_probability'
  FROM public.role_permissions existing
 WHERE existing.permission_key = ANY (ARRAY['crm.opportunities.edit', 'crm.opportunities.manage'])
ON CONFLICT DO NOTHING;

-- Whoever can reassign opportunities can change several at once.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'crm.opportunities.bulk_update'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'crm.opportunities.reassign'
ON CONFLICT DO NOTHING;

-- Whoever configures lead stages or CRM settings configures the sales stages.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'crm.pipeline.manage_stages'
  FROM public.role_permissions existing
 WHERE existing.permission_key = ANY (ARRAY['crm.leads.manage_stages', 'crm.settings.manage'])
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0013_crm_opportunity_pipeline.sql', 'crm-opportunity-pipeline');
