import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Vercent ERP Product Progress",
  description:
    "Follow meaningful public milestones across the Vercent ERP platform, product experience and design-partner readiness.",
  path: "/changelog",
});

const entries = [
  {
    date: "July 2026",
    title: "Production-hardened public product experience",
    status: "Website",
    items: [
      "Complete product, module, industry and implementation journeys",
      "Accessible responsive navigation and conversion paths",
      "Search metadata, structured data, sitemap and social preview",
      "Hardened form validation, abuse controls and deployment headers",
    ],
  },
  {
    date: "July 2026",
    title: "Design-partner programme preparation",
    status: "Go to market",
    items: [
      "Defined discovery, validation and pilot stages",
      "Created honest application and contact workflows",
      "Published implementation, security and commercial expectations",
      "Focused initial positioning on growing Indian operating businesses",
    ],
  },
  {
    date: "July 2026",
    title: "Multi-tenant ERP platform foundation",
    status: "Product engineering",
    items: [
      "Established the monorepo and shared package structure",
      "Prepared PostgreSQL and Redis local infrastructure",
      "Added control and tenant migration workflows",
      "Continued API, permission and module foundation work",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Product progress"
        title="Follow meaningful milestones across product, implementation and readiness."
        description="This public record describes completed foundations and current direction. Customer-facing release notes will begin when production product releases are available."
      />
      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="mx-auto max-w-3xl space-y-6">
            {entries.map((entry) => (
              <article
                key={entry.title}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-600">
                    {entry.status}
                  </p>
                  <time className="text-sm font-semibold text-slate-500">
                    {entry.date}
                  </time>
                </div>
                <h2 className="font-display mt-4 text-2xl font-extrabold text-slate-950">
                  {entry.title}
                </h2>
                <ul className="mt-5 space-y-3">
                  {entry.items.map((item) => (
                    <li
                      key={item}
                      className="flex gap-3 text-sm leading-7 text-slate-600"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
