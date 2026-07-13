import PageContainer from "@/components/layout/page-container";

import MarketingShell from "./marketing-shell";
import PageHero from "./page-hero";

export type LegalSection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

type LegalPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  updated: string;
  sections: LegalSection[];
};

export default function LegalPage({
  eyebrow,
  title,
  description,
  updated,
  sections,
}: LegalPageProps) {
  return (
    <MarketingShell>
      <PageHero eyebrow={eyebrow} title={title} description={description} />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="mx-auto max-w-3xl">
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">
              Last updated: {updated}. This document should be reviewed by
              qualified legal counsel before the platform begins processing
              production customer data.
            </p>

            <div className="mt-10 space-y-10">
              {sections.map((section) => (
                <section key={section.title} className="scroll-mt-28">
                  <h2 className="font-display text-2xl font-extrabold text-slate-950">
                    {section.title}
                  </h2>

                  <div className="mt-4 space-y-4">
                    {section.paragraphs.map((paragraph) => (
                      <p
                        key={paragraph}
                        className="text-sm leading-7 text-slate-600"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>

                  {section.bullets ? (
                    <ul className="mt-4 space-y-3">
                      {section.bullets.map((item) => (
                        <li
                          key={item}
                          className="flex gap-3 text-sm leading-7 text-slate-600"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600"
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
