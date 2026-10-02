import Link from "next/link";
import { SHARED_PLATFORM_KEY, getLandingModule, getWorkflowCapabilityGroups } from "@vercentlabs/landing-content";

/**
 * The approved capabilities a routed workflow relies on, grouped by the module
 * (or Shared Platform) that owns them. Names are resolved from the launch
 * capability register; internal IDs are never shown.
 */
export function WorkflowCapabilities({ slug }: { slug: string }) {
  const groups = getWorkflowCapabilityGroups(slug);
  return (
    <div className="grid grid-cols-1 gap-px bg-(--color-border-default) sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((group) => {
        const owner = group.ownerKey === SHARED_PLATFORM_KEY ? null : getLandingModule(group.ownerKey);
        const name = owner?.displayName ?? "Shared Platform";
        const href = owner ? `/modules/${owner.key}` : "/product/platform";
        return (
          <section key={group.ownerKey} className="border-t-[3px] bg-(--vl-paper-strong) p-5" style={{ borderTopColor: owner?.accentColor.hex ?? "var(--vl-brand)" }} aria-labelledby={`capabilities-${group.ownerKey}`}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 id={`capabilities-${group.ownerKey}`} className="text-base font-semibold tracking-[-0.025em] text-(--color-text-primary)">
                <Link href={href} prefetch={false} className="hover:text-(--color-text-brand)">
                  {name}
                </Link>
              </h3>
              <span className="vl-index">{group.capabilities.length}</span>
            </div>
            <ul className="mt-3 grid gap-1.5">
              {group.capabilities.map((capability) => (
                <li key={capability} className="text-sm leading-[1.5] text-(--color-text-secondary)">
                  {capability}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
