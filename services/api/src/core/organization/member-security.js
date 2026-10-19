// Account help an owner gives members (Shared Platform plan 3):
//   resetMemberMfa     a member lost their phone: their authenticator is removed (they set it up again at next sign-in, which the
//                      company's MFA rule then asks for), every session signed out; the owner or a system administrator only.
//   signOutMember      every session of a member ends, without disabling them (a lost laptop, a shared computer).
//   transferOwnership  the owner hands the company to another active member after re-entering their password; the old owner
//                      becomes a system administrator. Exactly one owner at a time.
// Each is audited and the member is emailed.
import { requireSessionPermission } from "../access/index.js";
import { sendSecurityAlert } from "../auth/profile.js";
import { verifyPassword } from "../auth/session.js";
import { audit } from "../security/request-security.js";

export class MemberSecurityError extends Error {
  constructor(status, message, code = "MEMBER_SECURITY_ERROR") {
    super(message);
    this.name = "MemberSecurityError";
    this.status = status;
    this.code = code;
  }
}

const isOwner = (session) => session.roleSlugs?.includes("organization_owner");
const isOwnerOrAdmin = (session) => isOwner(session) || session.roleSlugs?.includes("system_administrator");

async function activeMember(client, organizationId, userId) {
  const row = (await client.query(
    `SELECT membership.user_id, membership.role, app_user.email, app_user.full_name, app_user.mfa_enrolled_at
       FROM organization_memberships membership JOIN users app_user ON app_user.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.user_id = $2 AND membership.status = 'active'`, [organizationId, userId])).rows[0];
  if (!row) throw new MemberSecurityError(404, "That person is not an active member of this company.", "MEMBER_NOT_FOUND");
  return row;
}

async function revokeSessions(client, userId, reason) {
  return (await client.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`, [userId, reason])).rowCount;
}

export async function resetMemberMfa(client, session, targetUserId, { reason = "" } = {}, env = process.env) {
  if (!isOwnerOrAdmin(session)) throw new MemberSecurityError(403, "Only the owner or a system administrator can reset someone's two-step sign-in.", "MEMBER_SECURITY_DENIED");
  if (targetUserId === session.userId) throw new MemberSecurityError(409, "Reset your own two-step sign-in from your profile.", "MEMBER_SECURITY_SELF");
  const member = await activeMember(client, session.organizationId, targetUserId);
  if (member.role === "owner" && !isOwner(session)) throw new MemberSecurityError(403, "Only the owner can reset the owner's two-step sign-in.", "MEMBER_SECURITY_DENIED");
  if (!member.mfa_enrolled_at) throw new MemberSecurityError(409, `${member.full_name} has not set up two-step sign-in.`, "MEMBER_MFA_NOT_ENROLLED");
  await client.query(
    `UPDATE users SET mfa_secret_encrypted = NULL, mfa_enrolled_at = NULL, mfa_pending_secret_encrypted = NULL, mfa_pending_secret_expires_at = NULL, mfa_last_used_step = NULL WHERE id = $1`,
    [targetUserId]);
  await client.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [targetUserId]);
  const signedOut = await revokeSessions(client, targetUserId, "mfa_reset_by_admin");
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "auth.mfa.reset_by_admin", entityType: "user", entityId: targetUserId,
    metadata: { reason: String(reason).slice(0, 300) || null, sessionsSignedOut: signedOut } });
  await sendSecurityAlert(member, { subject: "Your two-step sign-in was reset", heading: "Your two-step sign-in was reset",
    message: `An administrator of your company removed your authenticator app${reason ? ` (${String(reason).slice(0, 200)})` : ""} and signed you out. Set it up again the next time you sign in.` }, env, client).catch(() => false);
  return { reset: true, sessionsSignedOut: signedOut };
}

export async function signOutMember(client, session, targetUserId, env = process.env) {
  requireSessionPermission(session, "users.manage");
  if (targetUserId === session.userId) throw new MemberSecurityError(409, "Sign yourself out of other devices from your profile.", "MEMBER_SECURITY_SELF");
  const member = await activeMember(client, session.organizationId, targetUserId);
  if (member.role === "owner" && !isOwner(session)) throw new MemberSecurityError(403, "Only the owner can sign the owner out.", "MEMBER_SECURITY_DENIED");
  const signedOut = await revokeSessions(client, targetUserId, "signed_out_by_admin");
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "auth.sessions.revoked_by_admin", entityType: "user", entityId: targetUserId, metadata: { sessionsSignedOut: signedOut } });
  await sendSecurityAlert(member, { subject: "You were signed out of Vercentlabs ERP", heading: "You were signed out",
    message: "An administrator of your company signed you out on every device. Sign in again to continue." }, env, client).catch(() => false);
  return { sessionsSignedOut: signedOut };
}

export async function transferOwnership(client, session, { targetUserId, password } = {}, env = process.env) {
  if (!isOwner(session)) throw new MemberSecurityError(403, "Only the owner can hand over ownership.", "MEMBER_SECURITY_DENIED");
  if (!targetUserId || targetUserId === session.userId) throw new MemberSecurityError(422, "Choose the member who becomes the owner.", "OWNERSHIP_TARGET_REQUIRED");
  const me = (await client.query(`SELECT email, full_name, password_hash FROM users WHERE id = $1`, [session.userId])).rows[0];
  if (!(await verifyPassword(String(password ?? ""), me?.password_hash))) throw new MemberSecurityError(403, "The password is not right.", "OWNERSHIP_PASSWORD_WRONG");
  const target = await activeMember(client, session.organizationId, targetUserId);
  const roles = (await client.query(`SELECT id, slug FROM roles WHERE organization_id = $1 AND slug IN ('organization_owner', 'system_administrator') AND status = 'active'`, [session.organizationId])).rows;
  const ownerRole = roles.find((role) => role.slug === "organization_owner");
  const adminRole = roles.find((role) => role.slug === "system_administrator");
  if (!ownerRole || !adminRole) throw new MemberSecurityError(500, "The owner and administrator roles are missing for this company.", "OWNERSHIP_ROLES_MISSING");
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext('ownership'))`, [session.organizationId]);

  const grant = async (userId, roleId, primary) => {
    const updated = await client.query(
      `UPDATE user_role_assignments SET status = 'active', revoked_at = NULL, revoked_by = NULL, is_primary = $4, assigned_by = $5, updated_at = now()
        WHERE organization_id = $1 AND user_id = $2 AND role_id = $3 RETURNING role_id`, [session.organizationId, userId, roleId, primary, session.userId]);
    if (!updated.rowCount) {
      await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status, assigned_by, reason) VALUES ($1, $2, $3, $4, 'active', $5, 'ownership transfer')`,
        [session.organizationId, userId, roleId, primary, session.userId]);
    }
  };
  // The new owner: owner role, primary; any other primary role stops being primary.
  await client.query(`UPDATE user_role_assignments SET is_primary = false WHERE organization_id = $1 AND user_id = $2 AND role_id <> $3`, [session.organizationId, targetUserId, ownerRole.id]);
  await grant(targetUserId, ownerRole.id, true);
  // The old owner: owner role revoked first (one primary role per person), then system administrator as the primary role.
  await client.query(
    `UPDATE user_role_assignments SET status = 'revoked', revoked_at = now(), revoked_by = $3, is_primary = false, updated_at = now()
      WHERE organization_id = $1 AND user_id = $2 AND role_id = $4 AND status = 'active'`, [session.organizationId, session.userId, session.userId, ownerRole.id]);
  await client.query(`UPDATE user_role_assignments SET is_primary = false WHERE organization_id = $1 AND user_id = $2 AND role_id <> $3`, [session.organizationId, session.userId, adminRole.id]);
  await grant(session.userId, adminRole.id, true);
  await client.query(`UPDATE organization_memberships SET role = CASE WHEN user_id = $2 THEN 'owner' ELSE 'admin' END WHERE organization_id = $1 AND user_id IN ($2, $3)`,
    [session.organizationId, targetUserId, session.userId]);
  const owners = Number((await client.query(
    `SELECT count(DISTINCT assignment.user_id) FROM user_role_assignments assignment WHERE assignment.organization_id = $1 AND assignment.role_id = $2 AND assignment.status = 'active'`,
    [session.organizationId, ownerRole.id])).rows[0].count);
  if (owners !== 1) throw new MemberSecurityError(409, "The company must have exactly one owner; the transfer was not made.", "OWNERSHIP_INVARIANT");
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "organization.ownership.transferred", entityType: "organization", entityId: session.organizationId,
    beforeData: { ownerUserId: session.userId }, afterData: { ownerUserId: targetUserId } });
  const company = (await client.query(`SELECT name FROM organizations WHERE id = $1`, [session.organizationId])).rows[0]?.name ?? "your company";
  await sendSecurityAlert(target, { subject: `You are now the owner of ${company}`, heading: "You are the owner now",
    message: `${me.full_name} handed ownership of ${company} on Vercentlabs ERP to you. You can manage billing, users and the company's data.` }, env, client).catch(() => false);
  await sendSecurityAlert(me, { subject: `You handed over ${company}`, heading: "Ownership handed over",
    message: `${target.full_name} is now the owner of ${company}. You remain a system administrator.` }, env, client).catch(() => false);
  return { ownerUserId: targetUserId, previousOwnerUserId: session.userId };
}
