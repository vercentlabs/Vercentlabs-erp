import ChangePasswordForm from "@/components/change-password-form";
import SessionManager from "@/components/session-manager";
import { requireWorkspace } from "@/lib/auth";
import { query } from "@/lib/db";

export const metadata = { title: "Account security" };
export default async function SecurityPage() {
  const session = await requireWorkspace();
  const rows = await query<{
    id: string;
    device_name: string | null;
    ip_address: string | null;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
  }>(
    `
    SELECT id, device_name, ip_address, created_at, last_seen_at, expires_at
    FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() AND idle_expires_at>now()
    ORDER BY last_seen_at DESC
  `,
    [session.userId],
  );
  const sessions = rows.map((row) => ({
    id: row.id,
    deviceName: row.device_name || "Unknown device",
    ipAddress: row.ip_address,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  }));
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Account security</p>
          <h1>Password and sessions</h1>
          <p>
            Change your password, review active devices and revoke access you no
            longer recognise.
          </p>
        </div>
      </section>
      <section className="content-grid">
        <article className="panel">
          <p className="eyebrow">Password</p>
          <h2>Change your password</h2>
          <ChangePasswordForm />
        </article>
        <article className="panel">
          <SessionManager
            sessions={sessions}
            currentSessionId={session.sessionId}
          />
        </article>
      </section>
      <section className="panel muted-panel">
        <p className="eyebrow">Multi-factor authentication</p>
        <h2>MFA-ready account foundation</h2>
        <p>
          The database records MFA policy and enrolment state. Enrolment and
          enforcement should be activated before production access for owners
          and administrators.
        </p>
      </section>
    </>
  );
}
