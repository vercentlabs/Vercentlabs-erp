BEGIN;

-- CRM completion (F020, F025, F030): explicit permissions for authorities that
-- previously all collapsed into crm.settings.manage or had no gate at all.
-- Grants to built-in roles come from packages/permissions/src/roles.js via
-- the canonical role sync migration that follows (073).
INSERT INTO permissions (key, name, category, description) VALUES
  ('crm.coverage.view', 'View sales coverage', 'CRM', 'See sales teams, territories, coverage gaps and unassigned records'),
  ('crm.teams.manage', 'Manage sales teams', 'CRM', 'Create and change sales teams, managers and memberships'),
  ('crm.territories.manage', 'Manage territories', 'CRM', 'Create and change the territory hierarchy and territory assignments'),
  ('crm.coverage.assign', 'Reassign coverage', 'CRM', 'Move ownership of leads, accounts and opportunities and transfer territory coverage'),
  ('crm.forecast.submit', 'Submit forecasts', 'CRM', 'Submit your own forecast for an open period'),
  ('crm.forecast.review', 'Review forecasts', 'CRM', 'Review, adjust and approve forecasts for the teams you manage'),
  ('crm.forecast.manage', 'Govern forecast periods', 'CRM', 'Open, lock and close forecast periods and capture forecast snapshots'),
  ('crm.reports.schedule', 'Schedule CRM reports', 'CRM', 'Schedule saved CRM reports for recurring delivery')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name, category = EXCLUDED.category, description = EXCLUDED.description;

COMMIT;
