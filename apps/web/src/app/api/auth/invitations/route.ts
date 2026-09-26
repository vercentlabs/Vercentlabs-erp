import { z } from "zod";

import { createOrganizationInvitation, getSeatStatus, listOrganizationInvitations } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    roleIds: z.array(z.string().uuid()).min(1).max(50),
    primaryRoleId: z.string().uuid(),
    companyIds: z.array(z.string().uuid()).max(200).default([]),
    branchIds: z.array(z.string().uuid()).max(500).default([]),
    departmentIds: z.array(z.string().uuid()).max(500).default([]),
    teamIds: z.array(z.string().uuid()).max(500).default([]),
    acknowledgeWarningConflicts: z.boolean().optional(),
  })
  .refine((body) => body.roleIds.includes(body.primaryRoleId), { message: "The primary role must be one of the selected roles.", path: ["primaryRoleId"] });

// Invitation administration (the public accept flow stays in
// auth/invitations/[token]). Roles and scope are validated by
// createOrganizationInvitation: grant ceiling, SoD, owner prohibition and,
// for delegated administrators, the scope ceiling.
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.usersManage, action: "settings.invitations.create", auditDenial: true },
    async ({ client, session }) => {
      const body = schema.parse(await readJson(request));
      const result = await createOrganizationInvitation(client, {
        organizationId: session.organizationId,
        invitedByUserId: session.userId,
        email: body.email,
        roleIds: body.roleIds,
        primaryRoleId: body.primaryRoleId,
        companyIds: body.companyIds,
        branchIds: body.branchIds,
        departmentIds: body.departmentIds,
        teamIds: body.teamIds,
        acknowledgeWarningConflicts: body.acknowledgeWarningConflicts,
        inviter: { roleSlugs: session.roleSlugs, permissions: session.permissions },
      });
      return ok({ invitationId: result.invitationId, delivered: result.delivered }, 201);
    },
  );
}

export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.usersManage, action: "settings.invitations.list" },
    async ({ client, session }) => {
      const invitations = await listOrganizationInvitations(client, session.organizationId, { userId: session.userId, roleSlugs: session.roleSlugs });
      const seats = await getSeatStatus(client, session.organizationId);
      return ok({ invitations, seats: { used: seats.used, capacity: seats.capacity, available: seats.available } });
    },
  );
}
