-- CRM permission wording: the screens say Company and Deal, so the permission names and descriptions an administrator reads in
-- Settings → Roles say the same. Keys (crm.accounts.*, crm.opportunities.*) do not change, so grants and checks are untouched.
-- "an account" / "an opportunity" are rewritten first so the article still fits the new word.

UPDATE public.permissions
   SET name = words.name, description = words.description
  FROM (
    SELECT key,
           regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           regexp_replace(regexp_replace(regexp_replace(regexp_replace(name,
             '\mAn account\M', 'A company', 'g'), '\man account\M', 'a company', 'g'),
             '\mAn opportunity\M', 'A deal', 'g'), '\man opportunity\M', 'a deal', 'g'),
             '\mAccounts\M', 'Companies', 'g'), '\maccounts\M', 'companies', 'g'),
             '\mAccount\M', 'Company', 'g'), '\maccount\M', 'company', 'g'),
             '\mOpportunities\M', 'Deals', 'g'), '\mopportunities\M', 'deals', 'g'),
             '\mOpportunity\M', 'Deal', 'g'), '\mopportunity\M', 'deal', 'g') AS name,
           regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           regexp_replace(regexp_replace(regexp_replace(regexp_replace(description,
             '\mAn account\M', 'A company', 'g'), '\man account\M', 'a company', 'g'),
             '\mAn opportunity\M', 'A deal', 'g'), '\man opportunity\M', 'a deal', 'g'),
             '\mAccounts\M', 'Companies', 'g'), '\maccounts\M', 'companies', 'g'),
             '\mAccount\M', 'Company', 'g'), '\maccount\M', 'company', 'g'),
             '\mOpportunities\M', 'Deals', 'g'), '\mopportunities\M', 'deals', 'g'),
             '\mOpportunity\M', 'Deal', 'g'), '\mopportunity\M', 'deal', 'g') AS description
      FROM public.permissions
     WHERE key LIKE 'crm.%' AND (name ~* '\m(accounts?|opportunit(y|ies))\M' OR description ~* '\m(accounts?|opportunit(y|ies))\M')
  ) words
 WHERE public.permissions.key = words.key;

-- The customer view-all permission capitalised its nouns; it reads in sentence case like the rest.
UPDATE public.permissions
   SET name = 'View all customer companies',
       description = 'See every customer company (not prospects), its contacts and the activities logged on them, regardless of owner.'
 WHERE key = 'crm.customers.view_all';

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0127_crm_permission_wording.sql', 'crm-permission-wording') ON CONFLICT DO NOTHING;
