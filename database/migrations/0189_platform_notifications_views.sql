-- Shared Platform plan, step 5: email notifications with a daily digest, and saved list views on every list, and the
-- "Bring your data" cut-over date.
--
-- 1. A person may get a daily digest email of what they have not read (user_preferences.digest_enabled). Instant email per
--    notification type uses the existing notification_preferences rows with channel 'email'.
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS digest_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS digest_sent_on date;

-- 2. Saved list views (a name, the filters, the sort and the columns), per person, or shared with the company, for any list.
CREATE TABLE IF NOT EXISTS public.saved_list_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  list_key text NOT NULL CHECK (list_key ~ '^[a-z0-9._-]{1,80}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  shared boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS saved_list_views_name_uidx ON public.saved_list_views (organization_id, user_id, list_key, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS saved_list_views_default_uidx ON public.saved_list_views (organization_id, user_id, list_key) WHERE is_default;
ALTER TABLE public.saved_list_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_list_views FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.saved_list_views;
CREATE POLICY organization_isolation ON public.saved_list_views USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_list_views TO vercent_app;

-- 3. "Bring your data": the cut-over date the company moves in on (opening stock, balances and open invoices are as of this day).
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS data_cutover_date date;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0189_platform_notifications_views.sql', 'platform-notifications-views') ON CONFLICT DO NOTHING;
