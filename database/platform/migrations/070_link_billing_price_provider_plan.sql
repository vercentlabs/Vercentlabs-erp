BEGIN;

-- The SaaS price catalogue (billing_plan_prices) is GLOBAL_CATALOGUE: the
-- restricted web/worker roles may only read it. The first paid checkout of a
-- price version must still record the provider plan it created once
-- (core/billing/catalogue.js ensureProviderPlan). A fresh database exposed it:
-- that UPDATE was denied, so a new environment could not sell a seat.
--
-- This function is the only write the runtime roles get: it links an UNLINKED
-- price version, once. Concurrent first checkouts converge on the first
-- plan id; the 061 trigger still forbids re-pointing a linked version.
-- Returns the linked plan id (the caller's, or the one that won).
CREATE OR REPLACE FUNCTION public.link_billing_price_provider_plan(p_price_id uuid, p_provider_plan_id text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  linked text;
BEGIN
  IF p_price_id IS NULL OR p_provider_plan_id IS NULL OR btrim(p_provider_plan_id) = '' OR length(p_provider_plan_id) > 200 THEN
    RAISE EXCEPTION 'link_billing_price_provider_plan needs a price id and a provider plan id' USING ERRCODE = '22023';
  END IF;
  UPDATE public.billing_plan_prices SET provider_plan_id = p_provider_plan_id WHERE id = p_price_id AND provider_plan_id IS NULL;
  SELECT provider_plan_id INTO linked FROM public.billing_plan_prices WHERE id = p_price_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown billing price %', p_price_id USING ERRCODE = '22023';
  END IF;
  RETURN linked;
END
$$;

REVOKE ALL ON FUNCTION public.link_billing_price_provider_plan(uuid, text) FROM PUBLIC;

COMMIT;
