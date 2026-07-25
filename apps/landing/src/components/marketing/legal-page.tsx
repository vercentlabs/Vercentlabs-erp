import PageContainer from "@/components/layout/page-container";

import MarketingShell from "./marketing-shell";
import PageHero from "./page-hero";
import { OperatorBand, OperatorNote } from "./operator-page";

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

      <OperatorBand
        index="01"
        eyebrow="Document"
        title="Read the operating terms in a usable structure."
        description={`Last updated ${updated}. Production use should be reviewed against the signed commercial and data-processing agreements.`}
        tone="white"
      >
        <OperatorNote label="Review notice">
          <p>
            This public baseline should be reviewed by qualified legal counsel
            before the platform processes production customer data.
          </p>
        </OperatorNote>

        <PageContainer width="wide" className="!px-0">
          <div className="operator-legal">
            <nav
              className="operator-legal__toc"
              aria-label={`${title} sections`}
            >
              {sections.map((section, index) => (
                <a key={section.title} href={`#legal-${index + 1}`}>
                  {section.title}
                </a>
              ))}
            </nav>

            <div className="operator-legal__content">
              {sections.map((section, index) => (
                <section
                  id={`legal-${index + 1}`}
                  key={section.title}
                  className="operator-legal__section scroll-mt-32"
                >
                  <h2>{section.title}</h2>
                  <div>
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                    {section.bullets ? (
                      <ul className="operator-list">
                        {section.bullets.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </PageContainer>
      </OperatorBand>
    </MarketingShell>
  );
}
