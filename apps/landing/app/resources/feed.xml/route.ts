import { RESOURCE_GUIDES, VERCENTLABS_VS_ODOO, CONTENT_AUTHORS, getFreshness } from "@vercentlabs/landing-content";
import { SITE, absoluteUrl } from "@/lib/site";

const AUTHOR = CONTENT_AUTHORS[0];

interface FeedEntry {
  title: string;
  path: string;
  summary: string;
}

/**
 * RSS 2.0 feed for real, dated resource content — the 6 cornerstone guides
 * plus the comparison page. Glossary terms are deliberately excluded: a
 * feed is for content worth being notified about (new/updated guides and
 * comparisons), not a static reference index. Dates come from the same
 * CONTENT_FRESHNESS registry every other page uses — no invented dates, no
 * full external copyrighted content (this only ever summarizes Vercentlabs'
 * own pages).
 */
function buildEntries(): FeedEntry[] {
  return [
    ...RESOURCE_GUIDES.map((guide) => ({ title: guide.title, path: `/resources/${guide.slug}`, summary: guide.metaDescription })),
    { title: `Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`, path: `/compare/${VERCENTLABS_VS_ODOO.slug}`, summary: VERCENTLABS_VS_ODOO.metaDescription },
  ];
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildFeedXml(): string {
  const entries = buildEntries()
    .map((entry) => ({ ...entry, freshness: getFreshness(entry.path) }))
    .sort((a, b) => (a.freshness.lastModifiedAt < b.freshness.lastModifiedAt ? 1 : -1));

  const latestDate = entries.length > 0 ? entries[0].freshness.lastModifiedAt : new Date().toISOString().slice(0, 10);

  const items = entries
    .map(
      (entry) => `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${absoluteUrl(entry.path)}</link>
      <guid isPermaLink="true">${absoluteUrl(entry.path)}</guid>
      <description>${escapeXml(entry.summary)}</description>
      <author>${escapeXml(AUTHOR.name)}</author>
      <pubDate>${new Date(`${entry.freshness.publishedAt}T00:00:00Z`).toUTCString()}</pubDate>
    </item>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(SITE.productName)} Resources</title>
    <link>${absoluteUrl("/resources")}</link>
    <description>ERP buying, implementation, and reference guides from ${escapeXml(SITE.productName)}.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(`${latestDate}T00:00:00Z`).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

export function GET() {
  return new Response(buildFeedXml(), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
