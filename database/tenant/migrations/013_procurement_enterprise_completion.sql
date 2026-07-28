BEGIN;

-- Durable cross-module document lineage for requisition -> sourcing/agreement/PO ->
-- receipt/match -> Accounting handoffs. The source and target can be inside or
-- outside Procurement without weakening tenant isolation.
CREATE TABLE IF NOT EXISTS tenant.procurement_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  relation_type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, source_id, target_type, target_id, relation_type)
);

ALTER TABLE tenant.procurement_document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_document_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_document_links_tenant_policy ON tenant.procurement_document_links;
CREATE POLICY procurement_document_links_tenant_policy
  ON tenant.procurement_document_links
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

CREATE INDEX IF NOT EXISTS procurement_document_links_source_idx
  ON tenant.procurement_document_links(organization_id,source_type,source_id);
CREATE INDEX IF NOT EXISTS procurement_document_links_target_idx
  ON tenant.procurement_document_links(organization_id,target_type,target_id);

-- Outbox delivery is leaseable, retryable and idempotent.
ALTER TABLE tenant.procurement_outbox
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS procurement_outbox_idempotency_uidx
  ON tenant.procurement_outbox(organization_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS procurement_outbox_delivery_idx
  ON tenant.procurement_outbox(status,available_at,lease_expires_at,created_at)
  WHERE status IN ('pending','retrying');

-- Document numbers and supplier codes must remain unique within a company.
CREATE UNIQUE INDEX IF NOT EXISTS procurement_supplier_code_uidx
  ON tenant.procurement_suppliers(organization_id,company_id,upper(data->>'supplierCode'))
  WHERE coalesce(data->>'supplierCode','')<>'' AND status<>'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS procurement_requisition_number_uidx
  ON tenant.procurement_requisitions(organization_id,company_id,upper(data->>'requisitionNumber'))
  WHERE coalesce(data->>'requisitionNumber','')<>'';
CREATE UNIQUE INDEX IF NOT EXISTS procurement_sourcing_number_uidx
  ON tenant.procurement_sourcing_events(organization_id,company_id,upper(data->>'eventNumber'))
  WHERE coalesce(data->>'eventNumber','')<>'';
CREATE UNIQUE INDEX IF NOT EXISTS procurement_agreement_number_uidx
  ON tenant.procurement_agreements(organization_id,company_id,upper(data->>'agreementNumber'))
  WHERE coalesce(data->>'agreementNumber','')<>'';
CREATE UNIQUE INDEX IF NOT EXISTS procurement_po_number_uidx
  ON tenant.procurement_purchase_orders(organization_id,company_id,upper(data->>'purchaseOrderNumber'))
  WHERE coalesce(data->>'purchaseOrderNumber','')<>'';
CREATE UNIQUE INDEX IF NOT EXISTS procurement_receipt_number_uidx
  ON tenant.procurement_receipts(organization_id,company_id,upper(data->>'receiptNumber'))
  WHERE coalesce(data->>'receiptNumber','')<>'';
CREATE UNIQUE INDEX IF NOT EXISTS procurement_service_entry_number_uidx
  ON tenant.procurement_service_entries(organization_id,company_id,upper(data->>'serviceEntryNumber'))
  WHERE coalesce(data->>'serviceEntryNumber','')<>'';
CREATE UNIQUE INDEX IF NOT EXISTS procurement_return_number_uidx
  ON tenant.procurement_returns(organization_id,company_id,upper(data->>'returnNumber'))
  WHERE coalesce(data->>'returnNumber','')<>'';
CREATE UNIQUE INDEX IF NOT EXISTS procurement_match_exception_number_uidx
  ON tenant.procurement_match_exceptions(organization_id,company_id,upper(data->>'exceptionNumber'))
  WHERE coalesce(data->>'exceptionNumber','')<>'';

-- Parent lookups are the critical path for document hydration and lifecycle work.
CREATE INDEX IF NOT EXISTS procurement_supplier_sites_parent_idx ON tenant.procurement_supplier_sites(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_supplier_qualifications_parent_idx ON tenant.procurement_supplier_qualifications(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_supplier_certifications_parent_idx ON tenant.procurement_supplier_certifications(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_supplier_scorecards_parent_idx ON tenant.procurement_supplier_scorecards(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_catalog_items_parent_idx ON tenant.procurement_catalog_items(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_requisition_lines_parent_idx ON tenant.procurement_requisition_lines(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_requisition_distributions_parent_idx ON tenant.procurement_requisition_distributions(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_sourcing_invitations_parent_idx ON tenant.procurement_sourcing_invitations(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_sourcing_bids_parent_idx ON tenant.procurement_sourcing_bids(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_sourcing_evaluations_parent_idx ON tenant.procurement_sourcing_evaluations(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_agreement_lines_parent_idx ON tenant.procurement_agreement_lines(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_purchase_order_lines_parent_idx ON tenant.procurement_purchase_order_lines(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_purchase_order_schedules_parent_idx ON tenant.procurement_purchase_order_schedules(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_advance_shipping_notices_parent_idx ON tenant.procurement_advance_shipping_notices(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_receipt_lines_parent_idx ON tenant.procurement_receipt_lines(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_service_entry_lines_parent_idx ON tenant.procurement_service_entry_lines(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_return_lines_parent_idx ON tenant.procurement_return_lines(organization_id,parent_id);
CREATE INDEX IF NOT EXISTS procurement_matching_records_parent_idx ON tenant.procurement_matching_records(organization_id,parent_id);

-- NOT VALID preserves upgrade safety for legacy rows while enforcing every new write.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_supplier_sites_parent_fk') THEN
    ALTER TABLE tenant.procurement_supplier_sites ADD CONSTRAINT procurement_supplier_sites_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_suppliers(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_supplier_qualifications_parent_fk') THEN
    ALTER TABLE tenant.procurement_supplier_qualifications ADD CONSTRAINT procurement_supplier_qualifications_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_suppliers(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_supplier_certifications_parent_fk') THEN
    ALTER TABLE tenant.procurement_supplier_certifications ADD CONSTRAINT procurement_supplier_certifications_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_suppliers(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_supplier_scorecards_parent_fk') THEN
    ALTER TABLE tenant.procurement_supplier_scorecards ADD CONSTRAINT procurement_supplier_scorecards_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_suppliers(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_catalog_items_parent_fk') THEN
    ALTER TABLE tenant.procurement_catalog_items ADD CONSTRAINT procurement_catalog_items_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_catalogs(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_requisition_lines_parent_fk') THEN
    ALTER TABLE tenant.procurement_requisition_lines ADD CONSTRAINT procurement_requisition_lines_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_requisitions(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_requisition_distributions_parent_fk') THEN
    ALTER TABLE tenant.procurement_requisition_distributions ADD CONSTRAINT procurement_requisition_distributions_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_requisitions(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_sourcing_invitations_parent_fk') THEN
    ALTER TABLE tenant.procurement_sourcing_invitations ADD CONSTRAINT procurement_sourcing_invitations_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_sourcing_events(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_sourcing_bids_parent_fk') THEN
    ALTER TABLE tenant.procurement_sourcing_bids ADD CONSTRAINT procurement_sourcing_bids_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_sourcing_events(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_sourcing_evaluations_parent_fk') THEN
    ALTER TABLE tenant.procurement_sourcing_evaluations ADD CONSTRAINT procurement_sourcing_evaluations_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_sourcing_events(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_agreement_lines_parent_fk') THEN
    ALTER TABLE tenant.procurement_agreement_lines ADD CONSTRAINT procurement_agreement_lines_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_agreements(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_purchase_order_lines_parent_fk') THEN
    ALTER TABLE tenant.procurement_purchase_order_lines ADD CONSTRAINT procurement_purchase_order_lines_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_purchase_orders(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_purchase_order_schedules_parent_fk') THEN
    ALTER TABLE tenant.procurement_purchase_order_schedules ADD CONSTRAINT procurement_purchase_order_schedules_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_purchase_orders(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_advance_shipping_notices_parent_fk') THEN
    ALTER TABLE tenant.procurement_advance_shipping_notices ADD CONSTRAINT procurement_advance_shipping_notices_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_purchase_orders(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_receipt_lines_parent_fk') THEN
    ALTER TABLE tenant.procurement_receipt_lines ADD CONSTRAINT procurement_receipt_lines_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_receipts(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_service_entry_lines_parent_fk') THEN
    ALTER TABLE tenant.procurement_service_entry_lines ADD CONSTRAINT procurement_service_entry_lines_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_service_entries(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_return_lines_parent_fk') THEN
    ALTER TABLE tenant.procurement_return_lines ADD CONSTRAINT procurement_return_lines_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_returns(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_matching_records_parent_fk') THEN
    ALTER TABLE tenant.procurement_matching_records ADD CONSTRAINT procurement_matching_records_parent_fk FOREIGN KEY(parent_id) REFERENCES tenant.procurement_purchase_orders(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

COMMIT;
