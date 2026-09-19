BEGIN;

-- SP001/SP004 real gap: acceptOrganizationInvitation (auth-lifecycle.js)
-- has always created organization_memberships + user_role_assignments
-- atomically, but NEVER membership_company_access/membership_branch_access
-- -- there was nowhere on organization_invitations to even record which
-- companies/branches the inviting admin intended to grant. A "member"-role
-- invitee (any role without organization_owner/system_administrator, which
-- bypass company/branch scoping entirely) joined the organization and then
-- saw zero companies and zero branches: invited into an organization they
-- could not actually work in. These columns are the missing piece the
-- invitation-acceptance transaction now reads to grant real access
-- atomically in the same transaction as membership + role.
ALTER TABLE organization_invitations
  ADD COLUMN IF NOT EXISTS company_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS branch_ids uuid[] NOT NULL DEFAULT '{}';

COMMIT;
