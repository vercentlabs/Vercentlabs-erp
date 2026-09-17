BEGIN;

-- POS Implementation Tracker, Session 2 (F277 Cart, F278 Taxes, F279
-- Discounts, F280 Promotions, F281 Coupons). Session 1 left POS with no
-- server-side cart aggregate at all (completePointOfSale took a flat,
-- unversioned lines[] array) and trusted client-supplied taxAmount/
-- discountAmount. This migration adds the durable cart aggregate (with
-- optimistic version locking, per PHASE 5), the promotion/coupon
-- definition + immutable-evidence tables (PHASE 8/9), and a nullable
-- variant_id on both the new cart lines and the pre-existing
-- pos_sale_lines (closing part of the F274 gap while this area is
-- already being touched, without expanding into a full lot/serial
-- requirement-validation pass).

-- F277: the cart aggregate. status uses only states with real,
-- distinct behavior — 'committing' was deliberately left out of the
-- state machine described in the session brief because the actual
-- concurrency guarantee comes from the row lock (SELECT ... FOR UPDATE)
-- taken for the whole duration of completion inside one DB transaction,
-- not from a separately-observable persisted status; a status column
-- can never actually be read by another connection in that transient
-- window under Postgres's transaction isolation, so persisting it would
-- be decorative, not "real transitions and meaningful behavior."
CREATE TABLE IF NOT EXISTS tenant.pos_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  terminal_id uuid NOT NULL REFERENCES tenant.pos_terminals(id),
  shift_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  cashier_user_id uuid NOT NULL,
  customer_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','priced','held','completed','cancelled','expired')),
  currency_code text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  subtotal numeric(20,6) NOT NULL DEFAULT 0,
  manual_discount_total numeric(20,6) NOT NULL DEFAULT 0,
  promotion_discount_total numeric(20,6) NOT NULL DEFAULT 0,
  coupon_discount_total numeric(20,6) NOT NULL DEFAULT 0,
  discount_total numeric(20,6) NOT NULL DEFAULT 0,
  tax_total numeric(20,6) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(20,6) NOT NULL DEFAULT 0,
  grand_total numeric(20,6) NOT NULL DEFAULT 0,
  tax_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  coupon_code text,
  cart_discount_type text CHECK (cart_discount_type IN ('percent','amount')),
  cart_discount_value numeric(18,4),
  cart_discount_reason text,
  priced_at timestamptz,
  held_at timestamptz,
  expires_at timestamptz,
  completed_sale_id uuid REFERENCES tenant.pos_sales(id) ON DELETE SET NULL,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS pos_carts_shift_idx
  ON tenant.pos_carts(organization_id,shift_id,status);
-- One open (non-terminal) cart per terminal at a time keeps the cashier
-- UI unambiguous about "what am I ringing up right now" — a cashier who
-- wants to start a second transaction must hold or complete the first.
CREATE UNIQUE INDEX IF NOT EXISTS pos_carts_one_active_per_terminal_uidx
  ON tenant.pos_carts(organization_id,terminal_id)
  WHERE status IN ('draft','priced');

CREATE TABLE IF NOT EXISTS tenant.pos_cart_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  cart_id uuid NOT NULL REFERENCES tenant.pos_carts(id) ON DELETE CASCADE,
  line_number integer NOT NULL CHECK (line_number > 0),
  item_id uuid NOT NULL,
  variant_id uuid,
  description text,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  list_price numeric(20,6) NOT NULL DEFAULT 0,
  unit_price numeric(20,6) NOT NULL DEFAULT 0,
  price_override boolean NOT NULL DEFAULT false,
  gross_amount numeric(20,6) NOT NULL DEFAULT 0,
  manual_discount_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (manual_discount_amount >= 0),
  manual_discount_reason text,
  promotion_discount_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (promotion_discount_amount >= 0),
  coupon_discount_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (coupon_discount_amount >= 0),
  taxable_amount numeric(20,6) NOT NULL DEFAULT 0,
  tax_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total numeric(20,6) NOT NULL DEFAULT 0,
  tax_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_promotion_ids uuid[] NOT NULL DEFAULT '{}',
  warehouse_id uuid,
  warehouse_location_id uuid,
  batch_id uuid,
  serial_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id,line_number)
);
CREATE INDEX IF NOT EXISTS pos_cart_lines_cart_idx
  ON tenant.pos_cart_lines(organization_id,cart_id);

-- F279: a manual line- or cart-level discount above the configured
-- approval threshold needs supervisor evidence BEFORE it can survive
-- into a completed sale. Bound to cart_version so a material cart change
-- after approval invalidates it (checked in application code: an
-- approval row's cart_version must equal the cart's current version at
-- the moment completion is attempted).
CREATE TABLE IF NOT EXISTS tenant.pos_cart_discount_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  cart_id uuid NOT NULL REFERENCES tenant.pos_carts(id) ON DELETE CASCADE,
  cart_version integer NOT NULL,
  cart_line_id uuid REFERENCES tenant.pos_cart_lines(id) ON DELETE CASCADE,
  discount_amount_snapshot numeric(20,6) NOT NULL,
  discount_percent_snapshot numeric(9,4),
  cart_subtotal_snapshot numeric(20,6) NOT NULL,
  reason text NOT NULL,
  requested_by uuid NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requested_by <> approved_by)
);
CREATE INDEX IF NOT EXISTS pos_cart_discount_approvals_cart_idx
  ON tenant.pos_cart_discount_approvals(organization_id,cart_id,cart_version);

-- F280: promotion definitions. Empty eligibility arrays mean "all" for
-- that dimension (matches the null-means-unscoped convention already used
-- by tenant.sales_pricing_rules) rather than "none" -- an empty array
-- filter is expressed as `array_length(...)=0 OR x = ANY(...)` in queries.
CREATE TABLE IF NOT EXISTS tenant.pos_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid,
  store_id uuid REFERENCES tenant.pos_stores(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  effective_from date,
  effective_to date,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','amount')),
  discount_value numeric(18,4) NOT NULL CHECK (discount_value > 0),
  max_discount_amount numeric(20,6) CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  min_quantity numeric(18,4) CHECK (min_quantity IS NULL OR min_quantity > 0),
  min_basket_amount numeric(20,6) CHECK (min_basket_amount IS NULL OR min_basket_amount >= 0),
  eligible_item_ids uuid[] NOT NULL DEFAULT '{}',
  eligible_item_group_ids uuid[] NOT NULL DEFAULT '{}',
  eligible_customer_ids uuid[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 100,
  stackable boolean NOT NULL DEFAULT false,
  exclusive boolean NOT NULL DEFAULT false,
  usage_limit_total integer CHECK (usage_limit_total IS NULL OR usage_limit_total > 0),
  usage_limit_per_customer integer CHECK (usage_limit_per_customer IS NULL OR usage_limit_per_customer > 0),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to),
  UNIQUE (organization_id,code)
);
CREATE INDEX IF NOT EXISTS pos_promotions_active_idx
  ON tenant.pos_promotions(organization_id,company_id,status);

-- Immutable evidence: which promotions actually applied to a completed
-- sale, and why -- the API's "why an attempted promotion did not apply"
-- explanation is computed at preview time and returned in the response,
-- not persisted (it is not evidence of anything that happened, only of
-- what almost happened); this table only records what DID apply.
CREATE TABLE IF NOT EXISTS tenant.pos_promotion_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  promotion_id uuid NOT NULL REFERENCES tenant.pos_promotions(id),
  sale_id uuid NOT NULL REFERENCES tenant.pos_sales(id) ON DELETE CASCADE,
  sale_line_id uuid REFERENCES tenant.pos_sale_lines(id) ON DELETE CASCADE,
  discount_amount numeric(20,6) NOT NULL CHECK (discount_amount >= 0),
  customer_id uuid,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_promotion_applications_promotion_idx
  ON tenant.pos_promotion_applications(organization_id,promotion_id);

-- F281: coupon definitions. code is stored normalized (upper, trimmed) by
-- application code; the unique index enforces that normalization can
-- never be bypassed by a caller sending mixed case.
CREATE TABLE IF NOT EXISTS tenant.pos_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid,
  store_id uuid REFERENCES tenant.pos_stores(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  effective_from date,
  effective_to date,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','amount')),
  discount_value numeric(18,4) NOT NULL CHECK (discount_value > 0),
  max_discount_amount numeric(20,6) CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  min_basket_amount numeric(20,6) CHECK (min_basket_amount IS NULL OR min_basket_amount >= 0),
  eligible_item_ids uuid[] NOT NULL DEFAULT '{}',
  eligible_customer_ids uuid[] NOT NULL DEFAULT '{}',
  usage_limit_total integer CHECK (usage_limit_total IS NULL OR usage_limit_total > 0),
  usage_limit_per_customer integer CHECK (usage_limit_per_customer IS NULL OR usage_limit_per_customer > 0),
  committed_count integer NOT NULL DEFAULT 0 CHECK (committed_count >= 0),
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_coupons_code_uidx
  ON tenant.pos_coupons(organization_id,upper(code));

-- Explicit reservation/commit/release lifecycle (PHASE 9): attaching a
-- coupon to a cart inserts 'reserved' (does not touch committed_count);
-- completing the sale flips it to 'committed' and atomically increments
-- committed_count on the coupon row under its own row lock; detaching a
-- coupon, cancelling/expiring the cart, or a failed/rolled-back
-- completion flips it to 'released'. One row per (coupon,cart) prevents
-- attaching the same coupon twice to the same cart.
CREATE TABLE IF NOT EXISTS tenant.pos_coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  coupon_id uuid NOT NULL REFERENCES tenant.pos_coupons(id),
  cart_id uuid REFERENCES tenant.pos_carts(id) ON DELETE SET NULL,
  sale_id uuid REFERENCES tenant.pos_sales(id) ON DELETE SET NULL,
  customer_id uuid,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released')),
  discount_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  released_at timestamptz,
  created_by uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_coupon_redemptions_active_cart_uidx
  ON tenant.pos_coupon_redemptions(coupon_id,cart_id)
  WHERE status = 'reserved' AND cart_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_coupon_redemptions_coupon_idx
  ON tenant.pos_coupon_redemptions(organization_id,coupon_id,status);

-- F274 (incidental closure while this area is already open): a cart line
-- or a completed sale line may represent a priced variant, not just a
-- plain item -- previously pos_sale_lines had no column for this at all,
-- so a variant's own sales_price could be resolved during search/barcode
-- lookup but never actually recorded against the resulting sale line.
ALTER TABLE tenant.pos_sale_lines ADD COLUMN IF NOT EXISTS variant_id uuid;

-- F279/F280/F281 evidence baked into the immutable sale line at
-- completion time so a receipt/audit can reconstruct exactly why a line's
-- discount_amount is what it is without re-deriving it from mutable cart
-- state (the cart itself may since have been deleted-by-cascade or the
-- promotion/coupon since deactivated).
ALTER TABLE tenant.pos_sale_lines ADD COLUMN IF NOT EXISTS manual_discount_amount numeric(20,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.pos_sale_lines ADD COLUMN IF NOT EXISTS promotion_discount_amount numeric(20,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.pos_sale_lines ADD COLUMN IF NOT EXISTS coupon_discount_amount numeric(20,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.pos_sale_lines ADD COLUMN IF NOT EXISTS tax_components jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant.pos_sales ADD COLUMN IF NOT EXISTS cart_id uuid REFERENCES tenant.pos_carts(id) ON DELETE SET NULL;
ALTER TABLE tenant.pos_sales ADD COLUMN IF NOT EXISTS coupon_code text;

-- F279 policy limits, added to the existing per-company policy table
-- rather than a new table -- pos_settings already holds
-- allow_price_override/require_return_approval as the established
-- location for this kind of simple company-wide POS policy flag.
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS max_line_discount_percent numeric(9,4) NOT NULL DEFAULT 100 CHECK (max_line_discount_percent BETWEEN 0 AND 100);
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS max_cart_discount_percent numeric(9,4) NOT NULL DEFAULT 100 CHECK (max_cart_discount_percent BETWEEN 0 AND 100);
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS discount_approval_threshold_percent numeric(9,4) NOT NULL DEFAULT 10 CHECK (discount_approval_threshold_percent BETWEEN 0 AND 100);
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS cart_expiry_minutes integer NOT NULL DEFAULT 240 CHECK (cart_expiry_minutes BETWEEN 5 AND 10080);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pos_carts',
    'pos_cart_lines',
    'pos_cart_discount_approvals',
    'pos_promotions',
    'pos_promotion_applications',
    'pos_coupons',
    'pos_coupon_redemptions'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON tenant.%I',
      table_name || '_organization_isolation',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
