-- GST — e-invoice and e-way-bill references obtained outside the ERP (MVP 43). Additive:
--   where an IRN or e-way bill was generated on the government portal (no GSP connected, or the GSP was down), its reference is recorded
--   against the document — origin 'external', with who recorded it and from what — so the obligation is tracked either way; a live one per
--   document (the existing live indexes).
-- Re-runnable.

ALTER TABLE tenant.einvoice_documents
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'gsp',
  ADD COLUMN IF NOT EXISTS recorded_note text;
ALTER TABLE tenant.eway_bills
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'gsp',
  ADD COLUMN IF NOT EXISTS recorded_note text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'einvoice_documents_origin_check') THEN
    ALTER TABLE tenant.einvoice_documents ADD CONSTRAINT einvoice_documents_origin_check CHECK (origin IN ('gsp', 'external'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eway_bills_origin_check') THEN
    ALTER TABLE tenant.eway_bills ADD CONSTRAINT eway_bills_origin_check CHECK (origin IN ('gsp', 'external'));
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0214_gst_portal_references.sql', 'gst-portal-references') ON CONFLICT DO NOTHING;
