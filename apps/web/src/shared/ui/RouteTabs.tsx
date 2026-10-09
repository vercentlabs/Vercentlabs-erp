import Link from "next/link";

// The tab bar of a workspace whose tabs are separate screens (?tab= in the URL, chosen by the server page): each tab is a link, so a
// tab survives refresh, back/forward and sharing, and switching starts that tab's own filters fresh.
export function RouteTabs({ label, base, tabs, current }: { label: string; base: string; tabs: ReadonlyArray<{ id: string; label: string }>; current: string }) {
  return (
    <nav aria-label={label} className="-mb-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <Link href={`${base}?tab=${tab.id}`} aria-current={tab.id === current ? "page" : undefined}
              className={`-mb-px flex border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                tab.id === current ? "border-brand text-text" : "border-transparent text-text-secondary hover:text-text"}`}>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
