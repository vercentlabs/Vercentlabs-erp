import Link from "next/link";

// The tab bar of a workspace whose tabs are separate screens (?tab= in the URL, chosen by the server page): each tab is a link, so a
// tab survives refresh, back/forward and sharing, and switching starts that tab's own filters fresh. Drawn like the design system's
// TabList: the base line is an inset shadow across the full width, so nothing spills out of the row and no scrollbar shows; on a
// narrow screen the row still scrolls sideways, without a visible bar.
export function RouteTabs({ label, base, tabs, current, className = "-mb-1" }: {
  label: string; base: string; tabs: ReadonlyArray<{ id: string; label: string }>; current: string; className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex max-w-full gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const selected = tab.id === current;
          return (
            <li key={tab.id} className="shrink-0">
              <Link href={`${base}?tab=${tab.id}`} aria-current={selected ? "page" : undefined}
                className={`flex items-center border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-[var(--motion-fast)] outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${
                  selected ? "border-brand text-text" : "border-transparent text-text-secondary hover:border-border-strong hover:text-text"}`}>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
