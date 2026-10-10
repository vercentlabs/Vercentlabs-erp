-- 0086 Cart (POS): the cashier's working bill — editable and temporary, never a sale, invoice, stock movement or payment.
--
-- Lifecycle: DRAFT (status draft / priced) → HELD → DRAFT; DRAFT → CHECKOUT_PENDING → COMPLETED; DRAFT / HELD → CANCELLED; eligible DRAFT /
-- HELD → EXPIRED. CHECKOUT_PENDING is a DRAFT cart holding the checkout lock (checkout_started_at): nothing on it can change, and it is never
-- cancelled or expired while a payment on it is unresolved. The stored status values stay as they are.
--
-- 1. The cart: a short reference for people (CART-1042; the UUID stays the identity), an optional sale note, the cashier now working on it,
--    who held it (with a note) and resumed it, the checkout lock (when, its reference, until when) and when it expired. A finalized sale is
--    linked to one cart only.
-- 2. Cart history: every material change with who made it and the cart version it produced.
-- 3. Policy: how long a held cart is kept (the draft inactivity window, cart_expiry_minutes, already exists) and how long an idle checkout
--    lock lasts when no payment is pending.

-- ============================================================ 1. the cart

ALTER TABLE tenant.pos_carts
  ADD COLUMN IF NOT EXISTS cart_reference text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS current_cashier_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hold_note text,
  ADD COLUMN IF NOT EXISTS held_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resumed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkout_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_reference uuid,
  ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_started_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_carts_notes_check') THEN
    ALTER TABLE tenant.pos_carts ADD CONSTRAINT pos_carts_notes_check CHECK ((notes IS NULL OR char_length(notes) <= 500) AND (hold_note IS NULL OR char_length(hold_note) <= 200));
  END IF;
  -- Only an open (draft / priced) cart can be in checkout.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_carts_checkout_lock_check') THEN
    ALTER TABLE tenant.pos_carts ADD CONSTRAINT pos_carts_checkout_lock_check CHECK (checkout_started_at IS NULL OR status IN ('draft', 'priced'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_carts_completed_sale_check') THEN
    ALTER TABLE tenant.pos_carts ADD CONSTRAINT pos_carts_completed_sale_check CHECK (status <> 'completed' OR completed_sale_id IS NOT NULL);
  END IF;
END $$;

-- References for carts made before this migration, in order of creation within each company.
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS n FROM tenant.pos_carts WHERE cart_reference IS NULL
)
UPDATE tenant.pos_carts cart SET cart_reference = 'CART-' || lpad(numbered.n::text, 4, '0') FROM numbered WHERE numbered.id = cart.id;
UPDATE tenant.pos_carts SET current_cashier_user_id = cashier_user_id WHERE current_cashier_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_carts_reference_uidx ON tenant.pos_carts (organization_id, cart_reference) WHERE cart_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pos_carts_completed_sale_uidx ON tenant.pos_carts (organization_id, completed_sale_id) WHERE completed_sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_carts_held_idx ON tenant.pos_carts (organization_id, store_id, held_at DESC) WHERE status = 'held';

-- ============================================================ 2. cart history

CREATE TABLE IF NOT EXISTS tenant.pos_cart_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cart_id uuid NOT NULL REFERENCES tenant.pos_carts(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created', 'item_added', 'quantity_changed', 'item_removed', 'tracking_set', 'line_discount_applied', 'line_discount_removed',
    'cart_discount_applied', 'cart_discount_removed', 'price_overridden', 'customer_changed', 'notes_changed', 'held', 'resumed', 'cancelled', 'checkout_started',
    'checkout_released', 'completed', 'expired')),
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  cart_version integer,
  terminal_id uuid REFERENCES tenant.pos_terminals(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS pos_cart_events_idx ON tenant.pos_cart_events (organization_id, cart_id, created_at);
ALTER TABLE tenant.pos_cart_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_cart_events FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_cart_events' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_cart_events USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.pos_cart_events TO vercent_app;
GRANT SELECT ON tenant.pos_cart_events TO vercent_worker;

-- ============================================================ 3. policy

ALTER TABLE tenant.pos_settings
  ADD COLUMN IF NOT EXISTS held_cart_retention_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS checkout_lock_minutes integer NOT NULL DEFAULT 15;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_cart_policy_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_cart_policy_check CHECK (held_cart_retention_hours BETWEEN 1 AND 2160 AND checkout_lock_minutes BETWEEN 2 AND 240);
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0086_pos_cart.sql', 'pos-cart') ON CONFLICT DO NOTHING;
