BEGIN;

-- F306 — Loyalty, PART 1: program configuration and the per-customer
-- balance cache. Kept in its own migration (separate from the ledger +
-- integration columns in 131) because a program can exist and be
-- configured before any ledger activity happens against it, mirroring how
-- 113 introduced tenant.pos_promotions ahead of pos_promotion_applications.
--
-- SCOPE DECISION: one program per COMPANY (organization_id,company_id
-- unique), not per-store like pos_promotions/pos_coupons -- loyalty
-- economics (earn rate, redemption value, expiry policy) are a finance/
-- company-wide policy decision in the vast majority of retail loyalty
-- programs, unlike a promotion or coupon which is routinely scoped to a
-- single store's local campaign. A future per-store override is a
-- documented, deliberately out-of-scope extension, not an oversight.
CREATE TABLE IF NOT EXISTS tenant.pos_loyalty_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  -- Points earned per 1 currency unit of eligible net (post-discount,
  -- pre-tax) spend. e.g. 0.1 = 1 point per 10 currency units spent.
  earn_rate_points_per_currency numeric(18,6) NOT NULL CHECK (earn_rate_points_per_currency > 0),
  -- Currency value of ONE point when redeemed. e.g. 0.5 = each point is
  -- worth 0.50 currency units off the payable amount.
  redemption_value_per_point numeric(18,6) NOT NULL CHECK (redemption_value_per_point > 0),
  min_redemption_points numeric(18,6) NOT NULL DEFAULT 0 CHECK (min_redemption_points >= 0),
  max_redemption_points_per_sale numeric(18,6) CHECK (max_redemption_points_per_sale IS NULL OR max_redemption_points_per_sale > 0),
  max_redemption_percent_of_payable numeric(9,4) CHECK (max_redemption_percent_of_payable IS NULL OR max_redemption_percent_of_payable BETWEEN 0 AND 100),
  min_eligible_sale_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (min_eligible_sale_amount >= 0),
  -- Modeled for a future expiry job (expirePosLoyaltyPoints in
  -- features/loyalty.js reads it) -- no scheduler/cron infrastructure
  -- exists in this codebase yet, so this migration and loyalty.js define
  -- the policy and the callable expiry function but do not wire a
  -- background scheduler; documented as a deliberate, bounded scope limit
  -- (the same kind of documented partial-scope decision F281's coupon
  -- partial-return reversal already sets a precedent for).
  points_expiry_days integer CHECK (points_expiry_days IS NULL OR points_expiry_days > 0),
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id)
);

-- F306 balance cache: derived from tenant.pos_loyalty_ledger (the source
-- of truth) but maintained as a denormalized running total so a
-- redemption's "can this customer actually afford this" check has a
-- single row to lock FOR UPDATE, exactly like pos_promotions.usage_count /
-- pos_coupons.committed_count are denormalized counters maintained in
-- lockstep with their own evidence tables under the SAME row lock. Scoped
-- by (organization_id,customer_id) ONLY, not per-company -- a customer in
-- tenant.business_parties is the organization's single shared customer
-- master (per this session's non-negotiables), and real multi-branch
-- retail loyalty is conventionally chain-wide, not siloed per legal
-- company; a company's own program still controls ITS OWN earn/redeem
-- rates applied against this one shared balance.
CREATE TABLE IF NOT EXISTS tenant.pos_loyalty_balances (
  organization_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  balance numeric(18,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, customer_id)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pos_loyalty_programs',
    'pos_loyalty_balances'
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
