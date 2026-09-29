BEGIN;

-- CONTRACT. F030 CRM reports use the governed shared reporting model: saved
-- report definitions (public.report_definitions over registered CRM datasets
-- computed by the canonical CRM metric layer), durable runs
-- (public.report_runs) and scheduled delivery (public.report_schedules /
-- report_deliveries). tenant.crm_report_definitions, crm_dashboards and
-- crm_dashboard_widgets were never read or executed by anything (generic CRUD
-- only, no screen), and the current application no longer registers them.
-- Precondition: they hold no rows. A tenant that stored rows through the old
-- generic API must export them first; this contract never discards them.

DO $$
DECLARE
  stored bigint := 0;
  counted bigint;
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['crm_dashboard_widgets', 'crm_dashboards', 'crm_report_definitions'] LOOP
    IF to_regclass('tenant.' || table_name) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM tenant.%I', table_name) INTO counted;
      stored := stored + counted;
    END IF;
  END LOOP;
  IF stored > 0 THEN
    RAISE EXCEPTION 'contract precondition failed: % row(s) remain in the retired CRM report/dashboard tables; export them before dropping', stored;
  END IF;
END
$$;

DROP TABLE IF EXISTS tenant.crm_dashboard_widgets;
DROP TABLE IF EXISTS tenant.crm_dashboards;
DROP TABLE IF EXISTS tenant.crm_report_definitions;

COMMIT;
