// Client-side navigation search (Part 4) — indexes the ALREADY
// server-resolved navigation tree (the same `ResolvedNavigationWithSettings`
// AppShell renders from, produced by resolveNavigation() in
// apps/web/src/app/(app)/layout.tsx). This function never sees the raw,
// unfiltered registry — an inaccessible module's items were already removed
// before this ever runs, so there is nothing here for an unauthorized
// destination to leak from (Part 4: "do not search the unfiltered raw
// registry on the client if doing so would expose unauthorized items").
import type { ResolvedNavigationWithSettings } from "@/lib/navigation/resolve-navigation";
import { scoreLabel } from "@/lib/search/score";
import type { SearchResult } from "@/lib/search/types";

type Candidate = {
  href: string;
  label: string;
  description?: string;
  icon: SearchResult["icon"];
  moduleId?: SearchResult["moduleId"];
  keywords?: string[];
};

export function flattenNavigation(navigation: ResolvedNavigationWithSettings): Candidate[] {
  const candidates: Candidate[] = [];

  for (const item of navigation.workspace) {
    candidates.push({ href: item.href, label: item.label, icon: item.icon, keywords: item.keywords });
  }

  for (const group of navigation.modules) {
    candidates.push({
      href: group.items[0]?.href ?? "",
      label: group.label,
      description: "Module overview",
      icon: group.icon,
      moduleId: group.moduleId,
      keywords: group.keywords,
    });
    for (const item of group.items) {
      candidates.push({
        href: item.href,
        label: item.label,
        description: group.label,
        icon: item.icon,
        moduleId: group.moduleId,
        keywords: item.keywords,
      });
    }
  }

  for (const item of navigation.myWork) {
    candidates.push({ href: item.href, label: item.label, icon: item.icon, keywords: item.keywords });
  }
  for (const item of navigation.governance) {
    candidates.push({ href: item.href, label: item.label, description: "Governance", icon: item.icon, keywords: item.keywords });
  }
  for (const item of navigation.administration) {
    candidates.push({ href: item.href, label: item.label, description: "Administration", icon: item.icon, keywords: item.keywords });
  }
  for (const item of navigation.workspaceSettings.items) {
    candidates.push({ href: item.href, label: item.label, description: "Workspace settings", icon: item.icon, keywords: item.keywords });
  }

  return candidates.filter((c) => c.href);
}

export function searchNavigation(
  navigation: ResolvedNavigationWithSettings,
  query: string,
  limit = 8,
): SearchResult[] {
  const candidates = flattenNavigation(navigation);
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreLabel(query, candidate.label, candidate.keywords),
    }))
    .filter((entry): entry is { candidate: Candidate; score: number } => entry.score !== null);

  scored.sort((a, b) => b.score - a.score || a.candidate.label.localeCompare(b.candidate.label));

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const { candidate } of scored) {
    if (seen.has(candidate.href)) continue;
    seen.add(candidate.href);
    results.push({
      id: `nav:${candidate.href}`,
      type: "navigation",
      label: candidate.label,
      description: candidate.description,
      href: candidate.href,
      icon: candidate.icon,
      moduleId: candidate.moduleId,
    });
    if (results.length >= limit) break;
  }
  return results;
}
