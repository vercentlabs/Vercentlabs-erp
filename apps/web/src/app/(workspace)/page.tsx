import { MODULE_NAVIGATION } from "@/shell/navigation/module-navigation-registry";
import { ModuleLauncher } from "@/features/platform/home/ModuleLauncher";
import { resolveWorkspaceContext } from "@/shell/workspace-context/resolveWorkspaceContext";

export const metadata = { title: "Home" };

// Home is the app launcher: a greeting and one tile per module the person may open, centred on the page at every screen size.
export default async function HomePage() {
  const { session, accessibleModules } = await resolveWorkspaceContext();
  const firstName = session.fullName.split(" ")[0] || session.fullName;
  const usable = new Set(
    accessibleModules.filter((m) => m.accessible).map((m) => m.moduleId),
  );
  const modules = MODULE_NAVIGATION.filter((m) => usable.has(m.moduleKey));

  return (
    <div className="flex flex-1 items-center justify-center py-4 sm:py-8">
      <div className="flex w-full max-w-5xl flex-col items-center gap-8 sm:gap-10">
        <div className="text-center">
          <p className="text-sm text-text-secondary">{session.organizationName}</p>
          <h1 className="text-2xl font-semibold text-text sm:text-3xl">{`Welcome, ${firstName}`}</h1>
        </div>

        {modules.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-border bg-surface p-4 text-center text-sm text-text-secondary">
            No modules are open to you yet. Ask an administrator to give you access.
          </p>
        ) : (
          <section aria-label="Your modules" className="w-full">
            <ModuleLauncher modules={modules} />
          </section>
        )}

        <p className="text-center text-sm text-text-secondary">
          Looking for something? Press Ctrl K, or use Search at the top, to find records and pages.
        </p>
      </div>
    </div>
  );
}
