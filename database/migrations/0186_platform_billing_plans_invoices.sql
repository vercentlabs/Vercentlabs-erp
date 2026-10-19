-- Shared Platform plan, step 2: plans and billing.
--
-- 1. Free = 1 user + 1 app. billing_plans.module_allowance says how many apps a plan lets a company pick (NULL = the plan's own
--    module list). The pick is organization_subscriptions.selected_modules; billing_module_switches records every pick and switch
--    (the switching rule — one switch per 30 days — reads it). Existing Free companies keep the apps they have (their
--    modules_snapshot is unchanged): only companies created from now on start with no app and choose one.
ALTER TABLE public.billing_plans ADD COLUMN IF NOT EXISTS module_allowance integer CHECK (module_allowance IS NULL OR module_allowance > 0);
ALTER TABLE public.organization_subscriptions ADD COLUMN IF NOT EXISTS selected_modules jsonb;
ALTER TABLE public.organization_subscriptions ADD COLUMN IF NOT EXISTS selected_modules_at timestamptz;
ALTER TABLE public.organization_subscriptions ADD COLUMN IF NOT EXISTS renewal_reminded_for timestamptz;

CREATE TABLE IF NOT EXISTS public.billing_module_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  to_modules jsonb NOT NULL,
  switched_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_module_switches_org_idx ON public.billing_module_switches (organization_id, created_at DESC);
-- Billing records like the others (OPERATOR_RUNTIME): only core/billing reads or writes them, always by organisation.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_module_switches TO vercent_app, vercent_worker;

UPDATE public.billing_plans
   SET module_allowance = 1, modules = '[]'::jsonb,
       description = 'For one person getting started: 1 user and 1 app of your choice, at no charge.',
       features = '["1 user", "1 app of your choice", "Switch app once a month", "Email support"]'::jsonb, updated_at = now()
 WHERE code = 'free';

-- 2. Standard = ₹699 per user per month, or ₹499 per user per month billed yearly (₹5,988 per user per year). Every user is paid
--    (no included user). New immutable price versions; the old ones retire (subscriptions keep the version they bought).
UPDATE public.billing_plan_prices SET active = false, retired_at = now()
 WHERE active AND plan_id = (SELECT id FROM public.billing_plans WHERE code = 'standard');
INSERT INTO public.billing_plan_prices (plan_id, billing_period, currency, amount_paise, version, included_users)
SELECT plan.id, period.billing_period, 'INR', period.amount_paise,
       COALESCE((SELECT max(version) FROM public.billing_plan_prices existing WHERE existing.plan_id = plan.id AND existing.billing_period = period.billing_period), 0) + 1, 0
  FROM public.billing_plans plan
 CROSS JOIN (VALUES ('monthly', 69900::bigint), ('yearly', 598800::bigint)) AS period(billing_period, amount_paise)
 WHERE plan.code = 'standard';
UPDATE public.billing_plans
   SET description = '₹699 per user per month, or ₹499 per user per month billed yearly. Every app.',
       features = '["All apps", "₹699 per user per month", "₹499 per user per month billed yearly", "Add or remove users any time", "Priority email support"]'::jsonb,
       included_users = 0, updated_at = now()
 WHERE code = 'standard';

-- 3. Usage limits: only what is counted and enforced stays on the plans — storage and outbound messages (emails, SMS, WhatsApp
--    sent by the apps). API requests, automation actions and import rows were never counted; they leave the plan rows.
UPDATE public.billing_plans
   SET limits = (limits - 'api_requests_monthly' - 'automation_actions_monthly' - 'imports_rows_monthly'), updated_at = now();
UPDATE public.billing_plans SET limits = jsonb_build_object('storage_gb', 2, 'outbound_messages_monthly', 500) WHERE code = 'free';
UPDATE public.billing_plans SET limits = jsonb_build_object('storage_gb', 100, 'outbound_messages_monthly', 20000) WHERE code = 'standard';
ALTER TABLE public.billing_usage_monthly ADD COLUMN IF NOT EXISTS warned_at timestamptz;

-- 4. Vercentlabs' own GST tax invoices and credit notes for subscription charges (billing_invoices with document_kind tax_invoice /
--    credit_note), numbered per financial year from one series (at most 16 characters).
ALTER TABLE public.billing_invoices DROP CONSTRAINT IF EXISTS billing_invoices_document_kind_check;
ALTER TABLE public.billing_invoices ADD CONSTRAINT billing_invoices_document_kind_check CHECK (document_kind IN ('provider_invoice', 'tax_invoice', 'credit_note'));
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS financial_year text;
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.billing_payments(id);
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS source_invoice_id uuid REFERENCES public.billing_invoices(id);
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS taxable_paise bigint;
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS cgst_paise bigint NOT NULL DEFAULT 0;
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS sgst_paise bigint NOT NULL DEFAULT 0;
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS igst_paise bigint NOT NULL DEFAULT 0;
ALTER TABLE public.billing_invoices ADD COLUMN IF NOT EXISTS tax_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.billing_invoices ALTER COLUMN provider_invoice_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_number_uidx ON public.billing_invoices (document_kind, invoice_number) WHERE invoice_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_payment_tax_invoice_uidx ON public.billing_invoices (payment_id) WHERE document_kind = 'tax_invoice';

CREATE TABLE IF NOT EXISTS public.billing_tax_invoice_series (
  document_kind text NOT NULL CHECK (document_kind IN ('tax_invoice', 'credit_note')),
  financial_year text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_kind, financial_year)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_tax_invoice_series TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0186_platform_billing_plans_invoices.sql', 'platform-billing-plans-invoices') ON CONFLICT DO NOTHING;
