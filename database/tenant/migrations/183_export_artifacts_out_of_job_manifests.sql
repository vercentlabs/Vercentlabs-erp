BEGIN;

-- Export files are Shared Platform artifacts now (object storage, expiring).
-- Older CRM lead export jobs carried the whole CSV inside result_manifest;
-- remove that copy (those exports were valid for 24 hours only). Row counts,
-- timestamps and the rest of the job evidence stay.
UPDATE tenant.background_jobs
   SET result_manifest = result_manifest - 'csv', updated_at = now()
 WHERE job_type = 'crm.leads.export' AND result_manifest ? 'csv';

COMMIT;
