BEGIN;

-- Prompt 6 (CRM-CAP-004, F018 — Email). Re-audit confirmed
-- crm_communications has no visibility concept at all: any caller holding
-- crm.leads.view_sensitive who can see the parent record can read every
-- linked email body, regardless of who sent it or who was a participant —
-- the dossier's explicit complaint: "Do not expose all team communication
-- simply because Opportunity is team-visible."
--
-- This adds the private-to-sender tier of the requested model. The other
-- two named tiers (visible-to-participants, sensitive-content-protected)
-- are NOT built in this pass: "participants" would require matching
-- To/Cc addresses back to real user accounts (no such mapping exists
-- today and inventing one is a bigger, separate feature), and
-- "sensitive-content-protected" is already what the existing
-- crm.leads.view_sensitive gate provides at the whole-communication level.
-- 'team' (the default, matching every existing communication's current
-- real-world visibility) keeps today's behavior unchanged for anyone who
-- already has record access; 'private' narrows it to the sender plus the
-- existing organization-wide view-all override, mirroring F017's Note
-- visibility column (migration 103) rather than inventing a third naming
-- convention for the same shape of problem.
ALTER TABLE tenant.crm_communications
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'team';

ALTER TABLE tenant.crm_communications
  DROP CONSTRAINT IF EXISTS crm_communications_visibility_check;
ALTER TABLE tenant.crm_communications
  ADD CONSTRAINT crm_communications_visibility_check CHECK (visibility IN ('team', 'private'));

COMMIT;
