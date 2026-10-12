-- 0097 POS Receipt Reprinting: another copy of an existing finalized receipt — never a new sale, payment, refund or invoice number. It reuses
-- the Receipt Printing records (0096): the document snapshot is the original, a reprint is one more print job (request_type 'reprint') marked
-- as a copy when it is rendered. This adds what reprinting needs on top:
--
-- 1. Print jobs: why the copy was asked for (an optional reason, required only when the company says so), the earlier print it copies, the
--    request's fingerprint (the same idempotency key with a different request is refused), and the hash of the rendered copy — kept apart
--    from the issued document's content hash, which never changes.
-- 2. Print attempts: every dispatch and retry of a job — attempt number, adapter, dispatch reference, outcome, error, timestamps.
-- 3. POS settings: whether a reprint needs a reason.
-- 4. Indexes for finding the original transaction: by amount, by date, by customer name.

-- ============================================================ 1. print jobs

ALTER TABLE tenant.pos_receipt_print_jobs
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS reason_note text,
  ADD COLUMN IF NOT EXISTS original_print_job_id uuid REFERENCES tenant.pos_receipt_print_jobs(id),
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS render_hash text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_receipt_print_jobs_reason_check') THEN
    ALTER TABLE tenant.pos_receipt_print_jobs ADD CONSTRAINT pos_receipt_print_jobs_reason_check CHECK (
      (reason_code IS NULL OR reason_code IN ('customer_request', 'receipt_lost', 'printer_failed', 'receipt_damaged', 'finance_verification', 'audit_request', 'other'))
      AND (reason_note IS NULL OR length(reason_note) <= 200)
      AND (reason_code IS DISTINCT FROM 'other' OR reason_note IS NOT NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS pos_receipt_print_jobs_reprint_idx ON tenant.pos_receipt_print_jobs (organization_id, created_at) WHERE request_type = 'reprint';

-- A print job's document, version and fingerprint never change once written: a retry is a new attempt, never a different job.
CREATE OR REPLACE FUNCTION tenant.pos_receipt_print_job_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.document_version IS DISTINCT FROM OLD.document_version OR NEW.request_type IS DISTINCT FROM OLD.request_type
     OR NEW.copy_label IS DISTINCT FROM OLD.copy_label OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint OR NEW.reason_code IS DISTINCT FROM OLD.reason_code THEN
    RAISE EXCEPTION 'A print job''s document and request cannot be changed.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_receipt_print_job_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_receipt_print_jobs_guard BEFORE UPDATE ON tenant.pos_receipt_print_jobs FOR EACH ROW EXECUTE FUNCTION tenant.pos_receipt_print_job_guard();

-- ============================================================ 2. print attempts

CREATE TABLE IF NOT EXISTS tenant.pos_receipt_print_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  print_job_id uuid NOT NULL REFERENCES tenant.pos_receipt_print_jobs(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  adapter text NOT NULL CHECK (adapter IN ('browser', 'print_agent', 'network_bridge')),
  dispatch_reference text,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'dispatched', 'acknowledged', 'failed', 'outcome_unknown', 'cancelled')),
  error_code text,
  confirmed_not_printed boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES public.users(id),
  UNIQUE (organization_id, print_job_id, attempt_number)
);
ALTER TABLE tenant.pos_receipt_print_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_receipt_print_attempts FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_receipt_print_attempts' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_receipt_print_attempts USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_receipt_print_attempts TO vercent_app;
GRANT SELECT ON tenant.pos_receipt_print_attempts TO vercent_worker;

-- Jobs printed before attempts were recorded get their first attempt, so every job has its history.
INSERT INTO tenant.pos_receipt_print_attempts (organization_id, print_job_id, attempt_number, adapter, status, error_code, started_at, completed_at, created_by)
SELECT job.organization_id, job.id, 1, COALESCE(printer.connection_mode, 'browser'),
       CASE WHEN job.status IN ('queued', 'rendering') THEN 'ready' ELSE job.status END, job.last_error_code, job.created_at, job.resolved_at, job.requested_by
  FROM tenant.pos_receipt_print_jobs job
  LEFT JOIN tenant.pos_receipt_printers printer ON printer.organization_id = job.organization_id AND printer.id = job.printer_id
 WHERE NOT EXISTS (SELECT 1 FROM tenant.pos_receipt_print_attempts attempt WHERE attempt.organization_id = job.organization_id AND attempt.print_job_id = job.id);

-- ============================================================ 3. POS settings

ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS receipt_reprint_reason_required boolean NOT NULL DEFAULT false;

-- ============================================================ 4. finding the original transaction

CREATE INDEX IF NOT EXISTS pos_sales_amount_idx ON tenant.pos_sales (organization_id, grand_total, sale_date DESC);
CREATE INDEX IF NOT EXISTS pos_sales_recent_idx ON tenant.pos_sales (organization_id, sale_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS pos_sales_buyer_name_idx ON tenant.pos_sales (organization_id, lower(buyer_name_snapshot) text_pattern_ops) WHERE buyer_name_snapshot IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_sales_receipt_prefix_idx ON tenant.pos_sales (organization_id, receipt_number text_pattern_ops);

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0097_pos_receipt_reprinting.sql', 'pos-receipt-reprinting') ON CONFLICT DO NOTHING;
