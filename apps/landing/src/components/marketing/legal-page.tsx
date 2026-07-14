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

      <section className="bg-white py-9 sm:py-16">
        <PageContainer>
          <div className="mx-auto max-w-3xl">
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900 sm:rounded-2xl sm:p-4 sm:text-sm sm:leading-7">
              Last updated: {updated}. This document should be reviewed by
              qualified legal counsel before the platform begins processing
              production customer data.
            </p>

            <div className="mt-7 space-y-7 sm:mt-10 sm:space-y-10">
              {sections.map((section) => (
                <section key={section.title} className="scroll-mt-28">
                  <h2 className="font-display text-xl font-extrabold text-slate-950 sm:text-2xl">
                    {section.title}
                  </h2>

                  <div className="mt-3 space-y-3 sm:mt-4 sm:space-y-4">
                    {section.paragraphs.map((paragraph) => (
                      <p
                        key={paragraph}
                        className="text-xs leading-6 text-slate-600 sm:text-sm sm:leading-7"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>

                  {section.bullets ? (
                    <ul className="mt-3 space-y-2 sm:mt-4 sm:space-y-3">
                      {section.bullets.map((item) => (
                        <li
                          key={item}
                          className="flex gap-2 text-xs leading-6 text-slate-600 sm:gap-3 sm:text-sm sm:leading-7"
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
