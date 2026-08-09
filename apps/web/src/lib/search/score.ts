// Lightweight scoring for local navigation search (Part 29). No fuzzy-search
// dependency — 121 navigation hrefs doesn't justify one, and the ranking
// rule is simple enough to hand-write: exact label > starts-with >
// word-prefix > keyword alias > substring. Returns null for no match so
// callers can filter cleanly.
const RANK = {
  exact: 100,
  startsWith: 80,
  wordPrefix: 60,
  keywordAlias: 40,
  substring: 20,
  keywordSubstring: 10,
} as const;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function scoreLabel(query: string, label: string, keywords?: string[]): number | null {
  const q = normalize(query);
  if (!q) return null;
  const l = normalize(label);

  if (l === q) return RANK.exact;
  if (l.startsWith(q)) return RANK.startsWith;
  if (l.split(/\s+/).some((word) => word.startsWith(q))) return RANK.wordPrefix;

  if (keywords?.length) {
    const normalizedKeywords = keywords.map(normalize);
    if (normalizedKeywords.some((k) => k === q || k.startsWith(q))) return RANK.keywordAlias;
    if (normalizedKeywords.some((k) => k.includes(q))) return RANK.keywordSubstring;
  }

  if (l.includes(q)) return RANK.substring;
  return null;
}
