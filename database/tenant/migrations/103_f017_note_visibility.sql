BEGIN;

-- Prompt 6 (CRM-CAP-004, F017 — Notes & Files). Re-audit found crm_notes
-- (migration 002) has no visibility concept at all: every Note attached to
-- a Lead is returned to any caller holding crm.leads.view_sensitive
-- (apps/web/src/modules/crm/server/lead-detail-data.ts), with no way for a
-- seller to keep a Note private to themselves. §43 of the dossier is
-- explicit: "A user who can view a Lead/Opportunity must not automatically
-- see a private Note. Implement independent Note-content visibility."
--
-- 'private' means visible only to the Note's author, or to a caller with
-- the organization-wide crm.records.view_all override (or the
-- organization_owner role) — the same "can view all records" override
-- note-operations.js's canViewAll check and follow-up-operations.js's
-- scopeSql already use for activity ownership scope, reused here rather
-- than inventing a second manager-override concept. 'shared' (the default,
-- matching every existing Note's current real-world visibility) keeps
-- today's behavior: visible to anyone who can already see the parent
-- record's sensitive content. This is additive and backward-compatible —
-- no existing Note's visibility narrows without an explicit choice.
ALTER TABLE tenant.crm_notes
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'shared';

ALTER TABLE tenant.crm_notes
  DROP CONSTRAINT IF EXISTS crm_notes_visibility_check;
ALTER TABLE tenant.crm_notes
  ADD CONSTRAINT crm_notes_visibility_check CHECK (visibility IN ('shared', 'private'));

COMMIT;
