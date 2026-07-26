BEGIN;

CREATE TABLE IF NOT EXISTS tenant.sales_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  default_price_list_id uuid REFERENCES tenant.price_lists(id) ON DELETE SET NULL,
  default_payment_term_id uuid REFERENCES tenant.payment_terms(id) ON DELETE SET NULL,
  seller_state_code text,
  default_quote_validity_days integer NOT NULL DEFAULT 15 CHECK (default_quote_validity_days BETWEEN 1 AND 365),
  quotation_approval_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (quotation_approval_amount >= 0),
  quotation_approval_discount numeric(9,4) NOT NULL DEFAULT 10 CHECK (quotation_approval_discount BETWEEN 0 AND 100),
  minimum_margin_percent numeric(9,4) NOT NULL DEFAULT 0 CHECK (minimum_margin_percent BETWEEN -100 AND 100),
  order_approval_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (order_approval_amount >= 0),
  allow_direct_orders boolean NOT NULL DEFAULT true,
  invoice_quantity_basis text NOT NULL DEFAULT 'ordered' CHECK (invoice_quantity_basis IN ('ordered','fulfilled')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.sales_tax_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  tax_category_id uuid REFERENCES tenant.tax_categories(id) ON DELETE SET NULL,
  supply_type text NOT NULL DEFAULT 'domestic' CHECK (supply_type IN ('domestic','export','sez','exempt','non_gst')),
  jurisdiction text NOT NULL DEFAULT 'any' CHECK (jurisdiction IN ('any','intrastate','interstate')),
  effective_from date,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to),
  UNIQUE (organization_id, company_id, code, effective_from)
);

CREATE TABLE IF NOT EXISTS tenant.sales_tax_group_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tax_group_id uuid NOT NULL REFERENCES tenant.sales_tax_groups(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 1 CHECK (sequence > 0),
  tax_type text NOT NULL CHECK (tax_type IN ('cgst','sgst','igst','cess','vat','sales_tax','other')),
  name text NOT NULL,
  rate numeric(9,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  compound_on_previous boolean NOT NULL DEFAULT false,
  recoverable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, tax_group_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.sales_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 10000),
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  party_type text CHECK (party_type IN ('customer','prospect','both')),
  item_id uuid REFERENCES tenant.items(id) ON DELETE CASCADE,
  item_group_id uuid REFERENCES tenant.item_groups(id) ON DELETE CASCADE,
  price_list_id uuid REFERENCES tenant.price_lists(id) ON DELETE CASCADE,
  minimum_quantity numeric(24,10) NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('discount_percent','discount_amount','fixed_rate')),
  adjustment_value numeric(24,10) NOT NULL CHECK (adjustment_value >= 0),
  valid_from date,
  valid_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.sales_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  quotation_number text NOT NULL,
  source_opportunity_id uuid REFERENCES tenant.crm_opportunities(id) ON DELETE SET NULL,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  current_version_id uuid,
  lifecycle_status text NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','pending_approval','approved','sent','viewed','accepted','rejected','expired','withdrawn','converted','cancelled')),
  approval_status text NOT NULL DEFAULT 'not_required' CHECK (approval_status IN ('not_required','pending','approved','rejected','cancelled')),
  acceptance_status text NOT NULL DEFAULT 'not_sent' CHECK (acceptance_status IN ('not_sent','pending','accepted','rejected','expired','revoked')),
  valid_until date NOT NULL,
  accepted_at timestamptz,
  rejected_at timestamptz,
  converted_order_id uuid,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, quotation_number),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.sales_quotation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL REFERENCES tenant.sales_quotations(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  revision_reason text,
  currency_code char(3) NOT NULL,
  base_currency_code char(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  price_list_id uuid REFERENCES tenant.price_lists(id) ON DELETE SET NULL,
  payment_term_id uuid REFERENCES tenant.payment_terms(id) ON DELETE SET NULL,
  billing_address_id uuid REFERENCES tenant.addresses(id) ON DELETE SET NULL,
  shipping_address_id uuid REFERENCES tenant.addresses(id) ON DELETE SET NULL,
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing_address_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  shipping_address_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_term_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_terms text,
  shipping_method text,
  incoterm text,
  place_of_supply text,
  supply_type text NOT NULL DEFAULT 'domestic' CHECK (supply_type IN ('domestic','export','sez','exempt','non_gst')),
  internal_notes text,
  customer_notes text,
  terms_and_conditions text,
  subtotal numeric(24,6) NOT NULL DEFAULT 0,
  discount_total numeric(24,6) NOT NULL DEFAULT 0,
  charge_total numeric(24,6) NOT NULL DEFAULT 0,
  tax_total numeric(24,6) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(24,6) NOT NULL DEFAULT 0,
  grand_total numeric(24,6) NOT NULL DEFAULT 0,
  base_currency_total numeric(24,6) NOT NULL DEFAULT 0,
  cost_total numeric(24,6) NOT NULL DEFAULT 0,
  margin_amount numeric(24,6) NOT NULL DEFAULT 0,
  margin_percent numeric(9,4) NOT NULL DEFAULT 0,
  maximum_discount_percent numeric(9,4) NOT NULL DEFAULT 0,
  pricing_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  tax_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, quotation_id, version_number),
  UNIQUE (organization_id, id)
);

ALTER TABLE tenant.sales_quotations
  DROP CONSTRAINT IF EXISTS sales_quotations_current_version_fkey;
ALTER TABLE tenant.sales_quotations
  ADD CONSTRAINT sales_quotations_current_version_fkey
  FOREIGN KEY (current_version_id) REFERENCES tenant.sales_quotation_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tenant.sales_quotation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quotation_version_id uuid NOT NULL REFERENCES tenant.sales_quotation_versions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  item_id uuid NOT NULL REFERENCES tenant.items(id) ON DELETE RESTRICT,
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id) ON DELETE RESTRICT,
  warehouse_id uuid REFERENCES tenant.warehouses(id) ON DELETE SET NULL,
  item_code_snapshot text NOT NULL,
  item_name_snapshot text NOT NULL,
  description_snapshot text,
  hsn_sac_snapshot text,
  uom_snapshot text NOT NULL,
  quantity numeric(24,10) NOT NULL CHECK (quantity > 0),
  base_quantity numeric(24,10) NOT NULL CHECK (base_quantity > 0),
  conversion_factor numeric(24,10) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  list_unit_price numeric(24,10) NOT NULL DEFAULT 0 CHECK (list_unit_price >= 0),
  unit_price numeric(24,10) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_percent numeric(9,4) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  discount_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  net_amount numeric(24,6) NOT NULL DEFAULT 0,
  tax_amount numeric(24,6) NOT NULL DEFAULT 0,
  line_total numeric(24,6) NOT NULL DEFAULT 0,
  standard_cost numeric(24,10) NOT NULL DEFAULT 0 CHECK (standard_cost >= 0),
  cost_amount numeric(24,6) NOT NULL DEFAULT 0,
  margin_amount numeric(24,6) NOT NULL DEFAULT 0,
  margin_percent numeric(9,4) NOT NULL DEFAULT 0,
  tax_category_id uuid REFERENCES tenant.tax_categories(id) ON DELETE SET NULL,
  tax_group_id uuid REFERENCES tenant.sales_tax_groups(id) ON DELETE SET NULL,
  requested_delivery_date date,
  manual_price_override boolean NOT NULL DEFAULT false,
  manual_price_reason text,
  pricing_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, quotation_version_id, sequence),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.sales_quotation_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quotation_version_id uuid NOT NULL REFERENCES tenant.sales_quotation_versions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  charge_type text NOT NULL CHECK (charge_type IN ('freight','handling','insurance','packing','other')),
  label text NOT NULL,
  calculation_type text NOT NULL CHECK (calculation_type IN ('fixed','percentage')),
  value numeric(24,10) NOT NULL CHECK (value >= 0),
  amount numeric(24,6) NOT NULL CHECK (amount >= 0),
  taxable boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, quotation_version_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.sales_quotation_tax_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quotation_version_id uuid NOT NULL REFERENCES tenant.sales_quotation_versions(id) ON DELETE CASCADE,
  quotation_line_id uuid REFERENCES tenant.sales_quotation_lines(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  tax_type text NOT NULL,
  label text NOT NULL,
  rate numeric(9,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  taxable_amount numeric(24,6) NOT NULL,
  tax_amount numeric(24,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.sales_quote_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL REFERENCES tenant.sales_quotations(id) ON DELETE CASCADE,
  quotation_version_id uuid NOT NULL REFERENCES tenant.sales_quotation_versions(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, token_hash)
);

CREATE TABLE IF NOT EXISTS tenant.sales_quote_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL REFERENCES tenant.sales_quotations(id) ON DELETE CASCADE,
  quotation_version_id uuid NOT NULL REFERENCES tenant.sales_quotation_versions(id) ON DELETE RESTRICT,
  share_link_id uuid REFERENCES tenant.sales_quote_share_links(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('accepted','rejected')),
  customer_name text NOT NULL,
  customer_email text,
  customer_title text,
  typed_signature text,
  note text,
  ip_address text,
  user_agent text,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, quotation_id)
);

CREATE TABLE IF NOT EXISTS tenant.sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  sales_order_number text NOT NULL,
  source_quotation_id uuid REFERENCES tenant.sales_quotations(id) ON DELETE SET NULL,
  source_quotation_version_id uuid REFERENCES tenant.sales_quotation_versions(id) ON DELETE SET NULL,
  source_opportunity_id uuid REFERENCES tenant.crm_opportunities(id) ON DELETE SET NULL,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  current_version_id uuid,
  lifecycle_status text NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','pending_approval','confirmed','on_hold','cancelled','closed')),
  approval_status text NOT NULL DEFAULT 'not_required' CHECK (approval_status IN ('not_required','pending','approved','rejected','cancelled')),
  credit_status text NOT NULL DEFAULT 'not_checked' CHECK (credit_status IN ('not_checked','passed','warning','blocked','overridden')),
  fulfillment_status text NOT NULL DEFAULT 'not_started' CHECK (fulfillment_status IN ('not_started','partially_allocated','allocated','partially_fulfilled','fulfilled','cancelled')),
  billing_status text NOT NULL DEFAULT 'not_billable' CHECK (billing_status IN ('not_billable','ready','partially_invoiced','fully_invoiced','blocked')),
  payment_status text NOT NULL DEFAULT 'not_due' CHECK (payment_status IN ('not_due','unpaid','partially_paid','paid','overdue','written_off')),
  order_date date NOT NULL DEFAULT current_date,
  requested_delivery_date date,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  closed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sales_order_number),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.sales_order_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  amendment_reason text,
  currency_code char(3) NOT NULL,
  base_currency_code char(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  price_list_id uuid REFERENCES tenant.price_lists(id) ON DELETE SET NULL,
  payment_term_id uuid REFERENCES tenant.payment_terms(id) ON DELETE SET NULL,
  billing_address_id uuid REFERENCES tenant.addresses(id) ON DELETE SET NULL,
  shipping_address_id uuid REFERENCES tenant.addresses(id) ON DELETE SET NULL,
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing_address_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  shipping_address_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_term_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_po_number text,
  customer_po_date date,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  delivery_terms text,
  shipping_method text,
  incoterm text,
  place_of_supply text,
  supply_type text NOT NULL DEFAULT 'domestic' CHECK (supply_type IN ('domestic','export','sez','exempt','non_gst')),
  internal_notes text,
  customer_notes text,
  terms_and_conditions text,
  subtotal numeric(24,6) NOT NULL DEFAULT 0,
  discount_total numeric(24,6) NOT NULL DEFAULT 0,
  charge_total numeric(24,6) NOT NULL DEFAULT 0,
  tax_total numeric(24,6) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(24,6) NOT NULL DEFAULT 0,
  grand_total numeric(24,6) NOT NULL DEFAULT 0,
  base_currency_total numeric(24,6) NOT NULL DEFAULT 0,
  cost_total numeric(24,6) NOT NULL DEFAULT 0,
  margin_amount numeric(24,6) NOT NULL DEFAULT 0,
  margin_percent numeric(9,4) NOT NULL DEFAULT 0,
  pricing_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  tax_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sales_order_id, version_number),
  UNIQUE (organization_id, id)
);

ALTER TABLE tenant.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_current_version_fkey;
ALTER TABLE tenant.sales_orders
  ADD CONSTRAINT sales_orders_current_version_fkey
  FOREIGN KEY (current_version_id) REFERENCES tenant.sales_order_versions(id) ON DELETE SET NULL;
ALTER TABLE tenant.sales_quotations
  DROP CONSTRAINT IF EXISTS sales_quotations_converted_order_fkey;
ALTER TABLE tenant.sales_quotations
  ADD CONSTRAINT sales_quotations_converted_order_fkey
  FOREIGN KEY (converted_order_id) REFERENCES tenant.sales_orders(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tenant.sales_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_version_id uuid NOT NULL REFERENCES tenant.sales_order_versions(id) ON DELETE CASCADE,
  source_quotation_line_id uuid REFERENCES tenant.sales_quotation_lines(id) ON DELETE SET NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  item_id uuid NOT NULL REFERENCES tenant.items(id) ON DELETE RESTRICT,
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id) ON DELETE RESTRICT,
  warehouse_id uuid REFERENCES tenant.warehouses(id) ON DELETE SET NULL,
  item_code_snapshot text NOT NULL,
  item_name_snapshot text NOT NULL,
  description_snapshot text,
  hsn_sac_snapshot text,
  uom_snapshot text NOT NULL,
  quantity numeric(24,10) NOT NULL CHECK (quantity > 0),
  base_quantity numeric(24,10) NOT NULL CHECK (base_quantity > 0),
  conversion_factor numeric(24,10) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  list_unit_price numeric(24,10) NOT NULL DEFAULT 0 CHECK (list_unit_price >= 0),
  unit_price numeric(24,10) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_percent numeric(9,4) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  discount_amount numeric(24,6) NOT NULL DEFAULT 0,
  net_amount numeric(24,6) NOT NULL DEFAULT 0,
  tax_amount numeric(24,6) NOT NULL DEFAULT 0,
  line_total numeric(24,6) NOT NULL DEFAULT 0,
  standard_cost numeric(24,10) NOT NULL DEFAULT 0 CHECK (standard_cost >= 0),
  cost_amount numeric(24,6) NOT NULL DEFAULT 0,
  margin_amount numeric(24,6) NOT NULL DEFAULT 0,
  margin_percent numeric(9,4) NOT NULL DEFAULT 0,
  tax_category_id uuid REFERENCES tenant.tax_categories(id) ON DELETE SET NULL,
  tax_group_id uuid REFERENCES tenant.sales_tax_groups(id) ON DELETE SET NULL,
  requested_delivery_date date,
  promised_delivery_date date,
  pricing_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sales_order_version_id, sequence),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.sales_order_line_progress (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_line_id uuid PRIMARY KEY REFERENCES tenant.sales_order_lines(id) ON DELETE CASCADE,
  confirmed_quantity numeric(24,10) NOT NULL DEFAULT 0 CHECK (confirmed_quantity >= 0),
  reserved_quantity numeric(24,10) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  fulfilled_quantity numeric(24,10) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
  invoiced_quantity numeric(24,10) NOT NULL DEFAULT 0 CHECK (invoiced_quantity >= 0),
  returned_quantity numeric(24,10) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  cancelled_quantity numeric(24,10) NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.sales_order_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_line_id uuid NOT NULL REFERENCES tenant.sales_order_lines(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  requested_date date,
  promised_date date,
  quantity numeric(24,10) NOT NULL CHECK (quantity > 0),
  fulfilled_quantity numeric(24,10) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0 AND fulfilled_quantity <= quantity),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','allocated','partially_fulfilled','fulfilled','cancelled')),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sales_order_line_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.sales_order_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE CASCADE,
  hold_type text NOT NULL CHECK (hold_type IN ('credit','commercial','inventory','compliance','customer','other')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  placed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  released_at timestamptz,
  release_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_order_single_active_hold_idx
  ON tenant.sales_order_holds(organization_id, sales_order_id, hold_type)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS tenant.sales_order_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE CASCADE,
  from_version_id uuid NOT NULL REFERENCES tenant.sales_order_versions(id) ON DELETE RESTRICT,
  to_version_id uuid NOT NULL REFERENCES tenant.sales_order_versions(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sales_order_id, to_version_id)
);

CREATE TABLE IF NOT EXISTS tenant.sales_fulfillment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_number text NOT NULL,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE RESTRICT,
  sales_order_version_id uuid NOT NULL REFERENCES tenant.sales_order_versions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  payload jsonb NOT NULL,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error text,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, request_number),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS tenant.sales_invoice_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_number text NOT NULL,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE RESTRICT,
  sales_order_version_id uuid NOT NULL REFERENCES tenant.sales_order_versions(id) ON DELETE RESTRICT,
  quantity_basis text NOT NULL CHECK (quantity_basis IN ('ordered','fulfilled')),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  payload jsonb NOT NULL,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error text,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, request_number),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS tenant.sales_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('quotation','sales_order','fulfillment_request','invoice_request')),
  entity_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_quotation_list_idx
  ON tenant.sales_quotations(organization_id, company_id, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS sales_quote_party_idx
  ON tenant.sales_quotations(organization_id, party_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sales_order_list_idx
  ON tenant.sales_orders(organization_id, company_id, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS sales_order_party_idx
  ON tenant.sales_orders(organization_id, party_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sales_document_events_idx
  ON tenant.sales_document_events(organization_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS sales_fulfillment_pending_idx
  ON tenant.sales_fulfillment_requests(organization_id, status, requested_at) WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS sales_invoice_pending_idx
  ON tenant.sales_invoice_requests(organization_id, status, requested_at) WHERE status IN ('pending','failed');

CREATE OR REPLACE FUNCTION tenant.sales_immutable_row()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable; create a new governed version', TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sales_quotation_versions','sales_quotation_lines','sales_quotation_charges',
    'sales_quotation_tax_lines','sales_quote_decisions','sales_order_versions',
    'sales_order_lines','sales_order_amendments','sales_document_events'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON tenant.%I', table_name || '_immutable', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.sales_immutable_row()', table_name || '_immutable', table_name);
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sales_settings','sales_tax_groups','sales_tax_group_components','sales_pricing_rules',
    'sales_quotations','sales_quotation_versions','sales_quotation_lines','sales_quotation_charges',
    'sales_quotation_tax_lines','sales_quote_share_links','sales_quote_decisions','sales_orders',
    'sales_order_versions','sales_order_lines','sales_order_line_progress','sales_order_schedules',
    'sales_order_holds','sales_order_amendments','sales_fulfillment_requests','sales_invoice_requests',
    'sales_document_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I', table_name);
    EXECUTE format(
      'CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      table_name
    );
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT column_catalog.table_name
    FROM information_schema.columns AS column_catalog
    WHERE column_catalog.table_schema = 'tenant'
      AND column_catalog.column_name = 'updated_at'
      AND column_catalog.table_name LIKE 'sales_%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON tenant.%I', table_name || '_touch_updated_at', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at()', table_name || '_touch_updated_at', table_name);
  END LOOP;
END $$;

INSERT INTO tenant.sales_settings (
  organization_id, default_price_list_id, default_payment_term_id, created_by, updated_by
)
SELECT organization.id,
       price_list.id,
       payment_term.id,
       organization.created_by,
       organization.created_by
FROM public.organizations organization
LEFT JOIN LATERAL (
  SELECT id FROM tenant.price_lists
  WHERE organization_id = organization.id AND code = 'STANDARD-SALES'
  LIMIT 1
) price_list ON true
LEFT JOIN LATERAL (
  SELECT id FROM tenant.payment_terms
  WHERE organization_id = organization.id AND code = 'NET-30'
  LIMIT 1
) payment_term ON true
ON CONFLICT (organization_id) DO NOTHING;

COMMIT;
