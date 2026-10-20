-- Quality — Final Inspection (MVP 33). The shared inspection engine (0203) and its production adapter (0204) applied to finished output: the
-- "Production output ready for QC" trigger checks each reported output before it is accepted as finished goods. Output under a mandatory final
-- check stays in production custody (awaiting inspection) until Quality clears it: Manufacturing accepts it, and the finished-goods receipt
-- brings it into stock, only up to that clearance — so nothing uncleared ever becomes available, allocated or dispatched.
--
--   1. the production context records a final-output checkpoint;
--   2. permissions quality.final.* and role grants.
-- Re-runnable.

-- ============================================================ 1. the final-output checkpoint
ALTER TABLE tenant.quality_inprocess_contexts DROP CONSTRAINT IF EXISTS quality_inprocess_contexts_checkpoint_type_check;
ALTER TABLE tenant.quality_inprocess_contexts ADD CONSTRAINT quality_inprocess_contexts_checkpoint_type_check
  CHECK (checkpoint_type IN ('FIRST_PIECE', 'OPERATION_COMPLETION', 'PERIODIC', 'MANUAL', 'REWORK', 'FINAL_OUTPUT'));

-- ============================================================ 2. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('quality.final.view', 'View final inspections', 'Quality', 'See finished-goods inspections, their results and what they hold.'),
  ('quality.final.create', 'Request final inspections', 'Quality', 'Request an inspection of finished production output.'),
  ('quality.final.assign', 'Assign final inspections', 'Quality', 'Assign or reassign the inspector.'),
  ('quality.final.start', 'Start final inspections', 'Quality', 'Begin an inspection and select its samples.'),
  ('quality.final.record_result', 'Record final inspection results', 'Quality', 'Save measurements and observations.'),
  ('quality.final.submit', 'Submit final inspections', 'Quality', 'Submit the results for evaluation and review.'),
  ('quality.final.review', 'Review final inspections', 'Quality', 'Review submitted results.'),
  ('quality.final.request_changes', 'Return final inspections', 'Quality', 'Send results back to the inspector.'),
  ('quality.final.complete', 'Complete final inspections', 'Quality', 'Finalize the inspection evidence.'),
  ('quality.final.reinspect', 'Request final reinspection', 'Quality', 'Request a retest of a defined quantity, or rework and reinspection.'),
  ('quality.final.correct', 'Correct final inspection results', 'Quality', 'Amend a recorded result with a reason (history kept).'),
  ('quality.final.cancel', 'Cancel final inspections', 'Quality', 'Cancel an eligible inspection.'),
  ('quality.final.export', 'Export final inspections', 'Quality', 'Download inspections and their reports.'),
  ('quality.final.view_audit', 'View final inspection history', 'Quality', 'See every result, amendment, review and decision.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('quality_manager'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('quality.final.view'), ('quality.final.create'), ('quality.final.assign'), ('quality.final.start'), ('quality.final.record_result'),
        ('quality.final.submit'), ('quality.final.review'), ('quality.final.request_changes'), ('quality.final.complete'), ('quality.final.reinspect'),
        ('quality.final.correct'), ('quality.final.cancel'), ('quality.final.export'), ('quality.final.view_audit')) AS k(key)
    UNION ALL
    SELECT * FROM (VALUES
      ('quality_supervisor', 'quality.final.view'), ('quality_supervisor', 'quality.final.create'), ('quality_supervisor', 'quality.final.assign'),
      ('quality_supervisor', 'quality.final.start'), ('quality_supervisor', 'quality.final.record_result'), ('quality_supervisor', 'quality.final.submit'),
      ('quality_supervisor', 'quality.final.review'), ('quality_supervisor', 'quality.final.request_changes'), ('quality_supervisor', 'quality.final.complete'),
      ('quality_supervisor', 'quality.final.reinspect'), ('quality_supervisor', 'quality.final.correct'), ('quality_supervisor', 'quality.final.export'),
      ('quality_supervisor', 'quality.final.view_audit'),
      ('quality_inspector', 'quality.final.view'), ('quality_inspector', 'quality.final.start'), ('quality_inspector', 'quality.final.record_result'),
      ('quality_inspector', 'quality.final.submit'),
      ('manufacturing_manager', 'quality.final.view'), ('manufacturing_manager', 'quality.final.create'), ('manufacturing_manager', 'quality.final.export'),
      ('production_supervisor', 'quality.final.view'), ('production_supervisor', 'quality.final.create'),
      ('production_planner', 'quality.final.view'), ('shop_floor_operator', 'quality.final.view'),
      ('inventory_manager', 'quality.final.view'), ('warehouse_operator', 'quality.final.view'),
      ('sales_manager', 'quality.final.view'),
      ('auditor', 'quality.final.view'), ('auditor', 'quality.final.export'), ('auditor', 'quality.final.view_audit')
    ) AS pair(slug, key)
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0205_quality_final_inspection.sql', 'quality-final-inspection') ON CONFLICT DO NOTHING;
