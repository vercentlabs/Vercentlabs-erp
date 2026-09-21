import Link from "next/link";
import { hasSessionPermission } from "@vercentlabs/api";

import { HomeAttention } from "@/features/platform/home/HomeAttention";
import { MODULE_NAVIGATION } from "@/shell/navigation/module-navigation-registry";
import { resolveWorkspaceContext } from "@/shell/workspace-context/resolveWorkspaceContext";

export const metadata = { title: "Home" };

// Everything on this page is either navigation the person is allowed to use or a count read from the same endpoint as
// the page it links to. There are no placeholder figures.
export default async function HomePage() {
  const { session, accessibleModules, pendingApprovalCount, unreadNotificationCount } = await resolveWorkspaceContext();
  const firstName = session.fullName.split(" ")[0] || session.fullName;
  const usable = new Set(accessibleModules.filter((m) => m.accessible).map((m) => m.moduleId));
  const modules = MODULE_NAVIGATION.filter((m) => usable.has(m.moduleKey));
  const canApprove = hasSessionPermission(session, "approvals.manage");

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div>
        <p className="text-sm text-text-secondary">{session.companyName ? session.companyName : session.organizationName}</p>
        <h1 className="text-2xl font-semibold text-text">{`Welcome, ${firstName}`}</h1>
      </div>

      <HomeAttention pendingApprovals={pendingApprovalCount} unreadNotifications={unreadNotificationCount} canApprove={canApprove} />

      <section aria-label="Your modules" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text">Your modules</h2>
        {modules.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm text-text-secondary">
            No modules are open to you yet. Ask an administrator to give you access.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((area) => (
              <Link
                key={area.moduleKey}
                href={area.sections[0]?.items[0]?.route ?? `/${area.moduleKey}`}
                className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm font-medium text-text hover:border-border-strong hover:bg-surface-muted"
              >
                <area.icon aria-hidden="true" className="size-5 text-text-secondary" />
                {area.label}
              </Link>
            ))}
          </div>
        )}
      </section>

      <p className="text-sm text-text-secondary">
        Looking for something? <Link href="/search" className="font-medium text-brand hover:underline">Search</Link> records and pages, or open{" "}
        <Link href="/work" className="font-medium text-brand hover:underline">My work</Link> for what needs you today.
      </p>
    </div>
  );
}
