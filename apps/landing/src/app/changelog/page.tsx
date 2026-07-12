import type { Metadata } from "next";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Follow public progress on the Vercent ERP product and landing application.",
  alternates: {
    canonical: "/changelog",
  },
};

const entries = [
  {
    date: "July 2026",
    title: "Complete public product experience",
    status: "Landing Phase 2",
    items: [
      "Expanded the homepage into the complete ERP product story",
      "Added module and industry route generation",
      "Added security, comparison, pricing, partner and implementation pages",
      "Aligned the visual system with the approved VercentLabs design",
    ],
  },
  {
    date: "July 2026",
    title: "Landing foundation",
    status: "Landing Phase 1",
    items: [
      "Established the responsive header, announcement bar and hero",
      "Introduced the Sora and Manrope typography system",
      "Created the shared 1440-pixel page container",
      "Added accessible mobile navigation and reveal-on-scroll behaviour",
    ],
  },
  {
    date: "July 2026",
    title: "ERP platform foundation",
    status: "Product development",
    items: [
      "Established the monorepo and shared-package structure",
      "Prepared local PostgreSQL and Redis infrastructure",
      "Added control and tenant database migration workflows",
      "Continued work on the multi-tenant API and web platform",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Public changelog"
        title="Follow what is being built without invented release claims."
        description="This page records meaningful public progress. Production product releases will be listed only after they are implemented, validated and available."
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="mx-auto max-w-3xl space-y-6">
            {entries.map((entry) => (
              <article
                key={entry.title}
                className="rounded-2xl border border-slate-200 bg-white p-6"
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
