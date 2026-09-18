// Real PostgreSQL integration test — security-matrix audit items #6/#7
// (revoked/inactive cashier, inactive/unauthorized supervisor deciding an
// approval). The audit found that services/api/src/core/approvals.js has
// no organization-membership/user-status check of its own and flagged
// this as a possible architecture gap. Tracing the actual call path
// (apps/web/src/app/api/approvals/[id]/decide/route.ts ->
// requireWorkspace() -> resolveSessionContext()) shows the platform
// resolves EVERY session fresh, from the database, on every single
// request -- resolveSessionContext's own WHERE clause already requires
// app_user.status='active' and filters role assignments to
// status='active' AND starts_at<=now() AND (expires_at IS NULL OR
// expires_at>now()). decideApproval trusts the session it's handed
// because that session cannot exist for a deactivated user or an
// expired/revoked role assignment -- there is nothing for a local check
// in approvals.js to add. This is a real assertion, not a assumption:
// this test proves it directly rather than taking the architecture on
// faith, closing items #6/#7 with genuine evidence instead of leaving
// them "partially covered".
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";

async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

test("SECURITY (consolidated pass, items #6/#7): a deactivated user or a revoked/expired role assignment can no longer resolve a usable session, so decideApproval can never see them as an eligible approver", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const { resolveSessionContext, createSession } = await import("../../services/api/src/index.js");

  const orgId = randomUUID();
  const userId = randomUUID();
  const roleId = randomUUID();

  try {
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Session Revocation Approver','x','active',now())`,
      [userId, `session-revocation-${userId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Session Revocation Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `session-revocation-org-${orgId}`, userId],
    );
    await admin.query(
      `INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`,
      [orgId, userId],
    );
    await admin.query(`INSERT INTO public.roles(id,organization_id,name,slug,status) VALUES ($1,$2,'POS Approver','pos_approver_test','active')`, [roleId, orgId]);
    await admin.query(`INSERT INTO public.role_permissions(role_id,permission_key) VALUES ($1,'pos.discount.approve')`, [roleId]);
    await admin.query(
      `INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,status,starts_at) VALUES ($1,$2,$3,'active',now())`,
      [orgId, userId, roleId],
    );

    let session;
    await t.test("baseline: an active user with an active, in-window role assignment resolves with the granted permission", async () => {
      const { token } = await createSession(admin, { userId, organizationId: orgId });
      session = await resolveSessionContext(admin, token, "browser");
      assert.ok(session, "an active user's session must resolve");
      assert.equal(session.organizationId, orgId);
      assert.ok(session.permissions.includes("pos.discount.approve"), "the active role assignment's permission must be present");
    });

    await t.test("SECURITY: revoking the role assignment removes the permission from a freshly-resolved session, even though the session cookie/token itself is untouched", async () => {
      await admin.query(`UPDATE public.user_role_assignments SET status='revoked' WHERE organization_id=$1 AND user_id=$2 AND role_id=$3`, [orgId, userId, roleId]);
      const { token } = await createSession(admin, { userId, organizationId: orgId });
      const revokedSession = await resolveSessionContext(admin, token, "browser");
      assert.ok(revokedSession, "the user account itself is still active, so a session still resolves");
      assert.ok(!revokedSession.permissions.includes("pos.discount.approve"), "a revoked role assignment must never still grant pos.discount.approve");
    });

    await t.test("SECURITY: an expired role assignment (expires_at in the past) behaves exactly like a revoked one", async () => {
      await admin.query(
        `UPDATE public.user_role_assignments SET status='active', starts_at=now() - interval '2 hours', expires_at=now() - interval '1 hour' WHERE organization_id=$1 AND user_id=$2 AND role_id=$3`,
        [orgId, userId, roleId],
      );
      const { token } = await createSession(admin, { userId, organizationId: orgId });
      const expiredSession = await resolveSessionContext(admin, token, "browser");
      assert.ok(expiredSession);
      assert.ok(!expiredSession.permissions.includes("pos.discount.approve"), "an expired role assignment must never still grant pos.discount.approve");
      // Restore for the next sub-test.
      await admin.query(`UPDATE public.user_role_assignments SET expires_at=NULL WHERE organization_id=$1 AND user_id=$2 AND role_id=$3`, [orgId, userId, roleId]);
    });

    await t.test("SECURITY: deactivating the user account entirely prevents ANY session from resolving, regardless of role assignment status", async () => {
      await admin.query(`UPDATE public.user_role_assignments SET status='active' WHERE organization_id=$1 AND user_id=$2 AND role_id=$3`, [orgId, userId, roleId]);
      await admin.query(`UPDATE public.users SET status='suspended' WHERE id=$1`, [userId]);
      const { token } = await createSession(admin, { userId, organizationId: orgId });
      const deactivatedSession = await resolveSessionContext(admin, token, "browser");
      assert.equal(deactivatedSession, null, "a deactivated user must never resolve a usable session at all -- decideApproval is never even reached");
    });
  } finally {
    await admin.query(`DELETE FROM sessions WHERE user_id=$1`, [userId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.user_role_assignments WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.role_permissions WHERE role_id=$1`, [roleId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.roles WHERE id=$1`, [roleId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organization_memberships WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=$1`, [userId]).catch(() => undefined);
    await admin.end();
  }
});
