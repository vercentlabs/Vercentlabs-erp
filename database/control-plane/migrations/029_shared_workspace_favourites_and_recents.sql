BEGIN;

-- Prompt 8 (Shared Workspace Foundation): Favourites and Recent Records.
--
-- Neither existing table fits: user_preferences (migration 002) is a fixed-
-- column, one-row-per-user shape (active_company_id/active_branch_id/locale/
-- timezone/theme) with no room for an open-ended per-entity list; audit_events
-- (migration 001) is DB-trigger immutable and mutation-only by convention
-- (57 real eventType call sites, zero "viewed" events) — turning it into a
-- view-tracking log would both violate its governance-trail purpose and
-- require a mutable index shape it deliberately doesn't have.
--
-- Both new tables follow user_preferences' own ownership pattern
-- (organization_id, user_id) rather than inventing a new one. Neither is
-- company/branch-scoped: a favourite or a recently-viewed record is a
-- personal workspace convenience, not tenant business data — the *target*
-- the stored href points at remains governed by its own existing
-- module/permission/record-scope checks every time it's read back (a stored
-- href is never itself treated as authorization, see
-- apps/web/src/lib/recent-records.ts and apps/web/src/lib/favourites.ts).

CREATE TABLE IF NOT EXISTS favourites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_href text NOT NULL,
  label text NOT NULL,
  module_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, target_href)
);
CREATE INDEX IF NOT EXISTS favourites_user_idx
  ON favourites(organization_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_href text NOT NULL,
  label text NOT NULL,
  module_key text,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, target_href)
);
CREATE INDEX IF NOT EXISTS recent_records_user_idx
  ON recent_records(organization_id, user_id, viewed_at DESC);

COMMIT;
