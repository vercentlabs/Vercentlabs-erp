BEGIN;

-- Bug: an organisation created through self-serve registration had an empty tenant.currencies table. Accounts,
-- price lists and exchange rates all reference (organization_id, currency_code) in that table, so the first
-- "New account" that carried the organisation's own currency failed with "Review the account scope and submitted
-- values" (business_parties_currency_fkey). registerOrganization now calls tenant.ensure_organization_base_currency(org) so the base currency the organisation
-- declared at registration exists from the start, and organisations that have none are repaired here. It is not a
-- trigger: integration tests create organisations directly and seed their own currencies. A currency an administrator already
-- maintains is left as it is.
CREATE OR REPLACE FUNCTION tenant.ensure_organization_base_currency(target_organization uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  declared text;
  previous text := current_setting('app.current_organization_id', true);
BEGIN
  SELECT upper(base_currency) INTO declared FROM public.organizations WHERE id = target_organization;
  IF declared IS NULL OR length(declared) <> 3 THEN
    RETURN;
  END IF;
  -- Row-level security is forced on this table, so the write has to run inside the organisation's own context.
  PERFORM set_config('app.current_organization_id', target_organization::text, true);
  IF NOT EXISTS (SELECT 1 FROM tenant.currencies WHERE organization_id = target_organization AND code = declared) THEN
    INSERT INTO tenant.currencies (organization_id, code, name, symbol, decimal_places, is_base, status)
    VALUES (
      target_organization, declared,
      CASE declared
        WHEN 'INR' THEN 'Indian Rupee' WHEN 'USD' THEN 'US Dollar' WHEN 'EUR' THEN 'Euro' WHEN 'GBP' THEN 'Pound Sterling'
        WHEN 'AED' THEN 'UAE Dirham' WHEN 'SGD' THEN 'Singapore Dollar' WHEN 'AUD' THEN 'Australian Dollar'
        WHEN 'CAD' THEN 'Canadian Dollar' WHEN 'JPY' THEN 'Japanese Yen' WHEN 'SAR' THEN 'Saudi Riyal' ELSE declared
      END,
      CASE declared
        WHEN 'INR' THEN '₹' WHEN 'USD' THEN '$' WHEN 'EUR' THEN '€' WHEN 'GBP' THEN '£' WHEN 'JPY' THEN '¥' ELSE NULL
      END,
      CASE WHEN declared = 'JPY' THEN 0 ELSE 2 END,
      NOT EXISTS (SELECT 1 FROM tenant.currencies WHERE organization_id = target_organization AND is_base),
      'active'
    );
  END IF;
  PERFORM set_config('app.current_organization_id', COALESCE(previous, ''), true);
END;
$$;

-- Repair existing organisations that never got their declared base currency.
SELECT tenant.ensure_organization_base_currency(o.id)
FROM public.organizations o
WHERE NOT EXISTS (SELECT 1 FROM tenant.currencies c WHERE c.organization_id = o.id);

COMMIT;
