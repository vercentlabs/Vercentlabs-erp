// The single shared active-route matcher. Previously reimplemented three
// times with slightly different call shapes (navigation-link.tsx,
// navigation-section.tsx's matchesPath, module-context-bar.tsx's matches) —
// see docs/implementation/ERP_NAVIGATION_FOUNDATION_006.md Section 2.
// Behavior is preserved exactly from the strictest of the three
// (navigation-link.tsx's redundant "/dashboard never prefix-matches" guard)
// so consolidating them changes no currently-active route highlighting.
export type MatchablePath = {
  href: string;
  exact?: boolean;
  activePrefixes?: string[];
};

function segmentMatch(pathname: string, target: string): boolean {
  return pathname === target || pathname.startsWith(`${target}/`);
}

export function matchesPath(pathname: string, item: MatchablePath): boolean {
  const primaryMatch =
    item.exact || item.href === "/dashboard"
      ? pathname === item.href
      : segmentMatch(pathname, item.href);
  if (primaryMatch) return true;
  return Boolean(item.activePrefixes?.some((prefix) => segmentMatch(pathname, prefix)));
}
