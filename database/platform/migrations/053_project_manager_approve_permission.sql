BEGIN;

-- The Project Manager role could create and plan a project but held no way to approve one, because
-- projects.approve was granted to nobody in the role catalogue. Approval of a project, baseline, budget,
-- billing line and closure is segregated in the domain (the creator cannot approve their own), so with the
-- permission granted a second project manager performs the approval.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'projects.approve'
FROM roles r
WHERE r.is_system = true AND r.template_key = 'project_manager'
ON CONFLICT DO NOTHING;

COMMIT;
