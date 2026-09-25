BEGIN;

-- Invitation access: the normalized tables become the ONE canonical source.
--
-- Two generations of invitation access storage existed: the normalized
-- tables (organization_invitation_roles / _company_access / _branch_access /
-- _department_access / _team_access) and the simpler legacy columns on
-- organization_invitations (role_id, company_ids, branch_ids) that the live
-- flow actually read and wrote. From this release the application writes and
-- reads the normalized tables (multiple roles, exactly one primary role,
-- company/branch scope mirroring user access).
--
-- This migration backfills every existing invitation's legacy state into the
-- normalized tables so no pending invitation loses access. Idempotent: rows
-- already present are left alone. Legacy values that no longer resolve inside
-- the same organization (deleted role/company/branch) are skipped, never
-- attached cross-tenant.
--
-- Zero-downtime transition: the legacy columns are NOT dropped here. New code
-- still mirrors the primary role and scope into them for one release so an
-- older instance in a rolling deployment keeps working; they are deprecated
-- and removed in a later cleanup once no reader remains.

INSERT INTO organization_invitation_roles (invitation_id, organization_id, role_id, is_primary)
SELECT invitation.id, invitation.organization_id, invitation.role_id, true
  FROM organization_invitations invitation
  JOIN roles role ON role.id = invitation.role_id AND role.organization_id = invitation.organization_id
 WHERE invitation.role_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM organization_invitation_roles existing WHERE existing.invitation_id = invitation.id)
ON CONFLICT DO NOTHING;

INSERT INTO organization_invitation_company_access (invitation_id, organization_id, company_id)
SELECT invitation.id, invitation.organization_id, company.id
  FROM organization_invitations invitation
  CROSS JOIN LATERAL unnest(invitation.company_ids) AS legacy(company_id)
  JOIN companies company ON company.id = legacy.company_id AND company.organization_id = invitation.organization_id
ON CONFLICT DO NOTHING;

INSERT INTO organization_invitation_branch_access (invitation_id, organization_id, branch_id)
SELECT invitation.id, invitation.organization_id, branch.id
  FROM organization_invitations invitation
  CROSS JOIN LATERAL unnest(invitation.branch_ids) AS legacy(branch_id)
  JOIN branches branch ON branch.id = legacy.branch_id AND branch.organization_id = invitation.organization_id
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN organization_invitations.role_id IS
  'DEPRECATED (transitional): mirror of the primary role. Canonical source: organization_invitation_roles. Remove after the rolling-deployment window.';
COMMENT ON COLUMN organization_invitations.company_ids IS
  'DEPRECATED (transitional): mirror of company scope. Canonical source: organization_invitation_company_access.';
COMMENT ON COLUMN organization_invitations.branch_ids IS
  'DEPRECATED (transitional): mirror of branch scope. Canonical source: organization_invitation_branch_access.';

COMMIT;
