BEGIN;

-- CONTRACT (run only with `pnpm db:migrate:contract`, after every instance
-- runs Prompt 6 code). Invitations are fully normalized
-- (organization_invitation_roles / _company_access / _branch_access /
-- _department_access / _team_access); no code reads or writes the legacy
-- mirrors any more.
--
-- 1. Final idempotent backfill from the legacy columns (covers any row an
--    older instance wrote before the rollout finished).
-- 2. Precondition: every invitation that carried a legacy role now has a
--    normalized role.
-- 3. Drop the mirrors.

INSERT INTO public.organization_invitation_roles (invitation_id, organization_id, role_id, is_primary)
SELECT invitation.id, invitation.organization_id, invitation.role_id, true
  FROM public.organization_invitations invitation
  JOIN public.roles role ON role.id = invitation.role_id AND role.organization_id = invitation.organization_id
 WHERE invitation.role_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.organization_invitation_roles existing WHERE existing.invitation_id = invitation.id)
ON CONFLICT DO NOTHING;

INSERT INTO public.organization_invitation_company_access (invitation_id, organization_id, company_id)
SELECT invitation.id, invitation.organization_id, company.id
  FROM public.organization_invitations invitation
  JOIN public.companies company ON company.organization_id = invitation.organization_id AND company.id = ANY(invitation.company_ids)
ON CONFLICT DO NOTHING;

INSERT INTO public.organization_invitation_branch_access (invitation_id, organization_id, branch_id)
SELECT invitation.id, invitation.organization_id, branch.id
  FROM public.organization_invitations invitation
  JOIN public.branches branch ON branch.organization_id = invitation.organization_id AND branch.id = ANY(invitation.branch_ids)
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  unresolved integer;
BEGIN
  SELECT count(*) INTO unresolved
    FROM public.organization_invitations invitation
   WHERE invitation.role_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.organization_invitation_roles normalized WHERE normalized.invitation_id = invitation.id);
  IF unresolved > 0 THEN
    RAISE EXCEPTION 'contract precondition failed: % invitation(s) still depend on the legacy role_id (the role no longer exists in the organisation)', unresolved;
  END IF;
END
$$;

ALTER TABLE public.organization_invitations
  DROP COLUMN IF EXISTS role_id,
  DROP COLUMN IF EXISTS company_ids,
  DROP COLUMN IF EXISTS branch_ids;

COMMIT;
