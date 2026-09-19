import { resolveWorkspaceContext } from "@/shell/workspace-context/resolveWorkspaceContext";

export const metadata = { title: "Home" };

// Phase 8: real global surfaces only, or an honest "not yet available"
// state — never fabricated KPIs/counts. My Work, Approvals, Notifications,
// Recent Records, Favorites, Background Jobs and Quick Create all still
// need their backing APIs confirmed/ported (see
// docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv) before this page can
// show real data instead of this honest placeholder.
export default async function HomePage() {
  const { session } = await resolveWorkspaceContext();
  const firstName = session.fullName.split(" ")[0] || session.fullName;

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div>
        <p className="text-sm text-text-muted">
          {session.companyName ? session.companyName : session.organizationName}
        </p>
        <h1 className="text-2xl font-semibold text-text">
          Welcome, {firstName}
        </h1>
      </div>
      <div className="rounded-[var(--radius-panel)] border border-border bg-surface p-6">
        <p className="text-sm text-text-secondary">
          Home surfaces (My Work, Approvals, Notifications, Recent Records,
          Favorites, Background Jobs, Quick Create) are being connected to their
          backing APIs one module at a time. This page will not show placeholder
          numbers before that data is real.
        </p>
      </div>
    </div>
  );
}
