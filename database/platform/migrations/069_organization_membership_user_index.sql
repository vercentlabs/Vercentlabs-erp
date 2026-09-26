BEGIN;

-- Session resolution, sign-in and the organization_memberships own_rows_read
-- policy (user_id = public.current_app_user_id(), migration 068) look up
-- memberships by user across every organisation; the (organization_id,
-- user_id) primary key cannot serve that, so each lookup walked the whole
-- index. Additive and backward compatible (expand).
CREATE INDEX IF NOT EXISTS organization_memberships_user_idx ON public.organization_memberships (user_id);

COMMIT;
