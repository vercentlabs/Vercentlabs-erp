import { requireWorkspace } from "@/core/session";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const session = await requireWorkspace();

  return (
    <div className="flex flex-1 flex-col gap-6 px-8 py-10">
      <h1 className="text-xl font-semibold text-text">Profile</h1>
      <dl className="grid max-w-[480px] grid-cols-[140px_1fr] gap-y-3 text-sm">
        <dt className="text-text-muted">Name</dt>
        <dd className="text-text">{session.fullName}</dd>
        <dt className="text-text-muted">Email</dt>
        <dd className="text-text">{session.email}</dd>
        <dt className="text-text-muted">Organisation</dt>
        <dd className="text-text">{session.organizationName}</dd>
        <dt className="text-text-muted">Company</dt>
        <dd className="text-text">{session.companyName || "—"}</dd>
        <dt className="text-text-muted">Branch</dt>
        <dd className="text-text">{session.branchName || "—"}</dd>
        <dt className="text-text-muted">Locale</dt>
        <dd className="text-text">{session.locale}</dd>
        <dt className="text-text-muted">Timezone</dt>
        <dd className="text-text">{session.timezone}</dd>
      </dl>
      <p className="max-w-[480px] text-sm text-text-secondary">
        Preferences, sessions/devices and MFA/security controls land alongside
        the rest of Settings.
      </p>
    </div>
  );
}
