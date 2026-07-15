import ProfileForm from "@/components/profile-form";
import { requireWorkspace } from "@/lib/auth";
import { query } from "@/lib/db";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const session = await requireWorkspace();
  const [logins, preferences] = await Promise.all([
    query<{
      succeeded: boolean;
      reason: string | null;
      ip_address: string | null;
      user_agent: string | null;
      created_at: Date;
    }>(
      `
      SELECT succeeded, reason, ip_address, user_agent, created_at
      FROM login_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10
    `,
      [session.userId],
    ),
    query<{
      locale: string;
      timezone: string;
      theme: "system" | "light" | "dark";
    }>(
      `
      SELECT COALESCE(p.locale,'en-IN') AS locale,
        COALESCE(p.timezone,o.timezone) AS timezone,
        COALESCE(p.theme,'system') AS theme
      FROM organizations o
      LEFT JOIN user_preferences p ON p.organization_id=o.id AND p.user_id=$2
      WHERE o.id=$1
    `,
      [session.organizationId, session.userId],
    ),
  ]);
  const preference = preferences[0] || {
    locale: "en-IN",
    timezone: "Asia/Kolkata",
    theme: "system" as const,
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Personal account</p>
          <h1>Your profile</h1>
          <p>
            Maintain your identity, preferences and review recent authentication
            activity.
          </p>
        </div>
      </section>
      <div className="content-grid">
        <section className="panel profile-card">
          <div className="avatar">
            {session.fullName.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2>{session.fullName}</h2>
            <p>{session.email}</p>
            <div className="chip-row">
              {session.roleSlugs.map((role) => (
                <span key={role}>{role.replaceAll("_", " ")}</span>
              ))}
              <span>Email verified</span>
              <span>{session.organizationName}</span>
            </div>
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Preferences</p>
          <h2>Profile settings</h2>
          <ProfileForm
            fullName={session.fullName}
            locale={preference.locale}
            theme={preference.theme}
            timezone={preference.timezone}
          />
        </section>
      </div>
      <section className="panel">
        <p className="eyebrow">Login history</p>
        <h2>Recent authentication activity</h2>
        <div className="table-panel embedded">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Result</th>
                <th>IP</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {logins.map((login, index) => (
                <tr key={index}>
                  <td>{new Date(login.created_at).toLocaleString()}</td>
                  <td>{login.succeeded ? "Succeeded" : "Failed"}</td>
                  <td>{login.ip_address || "—"}</td>
                  <td>{login.reason || "—"}</td>
                </tr>
              ))}
              {!logins.length ? (
                <tr>
                  <td colSpan={4}>No login history recorded.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
