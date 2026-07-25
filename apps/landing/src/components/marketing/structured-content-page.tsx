import MarketingShell from "./marketing-shell";
import PageHero from "./page-hero";
import {
  OperatorActions,
  OperatorBand,
  OperatorCard,
  OperatorFinalCta,
  OperatorGrid,
  OperatorList,
  OperatorNote,
  OperatorSteps,
} from "./operator-page";

export type ContentItem = {
  title: string;
  description: string;
};

export type ContentSection = {
  eyebrow?: string;
  title: string;
  paragraphs?: string[];
  connectedModules?: string;
  items?: ContentItem[];
  bullets?: string[];
  afterBullets?: string;
  steps?: string[];
  stepsLabel?: string;
  outcome?: string;
  outcomeLabel?: string;
  cta?: { label: string; href: string };
  tone?: "white" | "muted" | "dark";
};

export type StructuredPageConfig = {
  hero: {
    eyebrow: string;
    title: string;
    description: string;
    primary: { label: string; href: string };
    secondary: { label: string; href: string };
  };
  sections: ContentSection[];
  finalCta: {
    title: string;
    description: string;
    primary: { label: string; href: string };
    secondary: { label: string; href: string };
  };
};

export default function StructuredContentPage({
  config,
}: {
  config: StructuredPageConfig;
}) {
  return (
    <MarketingShell>
      <PageHero
        eyebrow={config.hero.eyebrow}
        title={config.hero.title}
        description={config.hero.description}
        actions={
          <OperatorActions
            primary={config.hero.primary}
            secondary={config.hero.secondary}
          />
        }
      />

      {config.sections.map((section, index) => {
        const tone =
          section.tone === "dark"
            ? "ink"
            : section.tone === "muted"
              ? "white"
              : index % 2 === 0
                ? "paper"
                : "white";
        const remainingParagraphs = section.paragraphs?.slice(1) ?? [];

        return (
          <OperatorBand
            key={section.title}
            index={String(index + 1).padStart(2, "0")}
            eyebrow={section.eyebrow}
            title={section.title}
            description={section.paragraphs?.[0]}
            tone={tone}
          >
            {remainingParagraphs.length ? (
              <div className="operator-prose">
                {remainingParagraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            ) : null}

            {section.connectedModules ? (
              <OperatorNote label="Connected modules">
                <p>{section.connectedModules}</p>
              </OperatorNote>
            ) : null}

            {section.items ? (
              <OperatorGrid columns={section.items.length >= 7 ? 4 : 3}>
                {section.items.map((item, itemIndex) => (
                  <OperatorCard
                    key={item.title}
                    index={String(itemIndex + 1).padStart(2, "0")}
                    title={item.title}
                    description={item.description}
                  />
                ))}
              </OperatorGrid>
            ) : null}

            {section.bullets ? <OperatorList items={section.bullets} /> : null}

            {section.afterBullets ? (
              <div className="operator-prose operator-prose--after">
                <p>{section.afterBullets}</p>
              </div>
            ) : null}

            {section.steps ? (
              <div className="operator-stack">
                {section.stepsLabel ? (
                  <p className="operator-stack__label">{section.stepsLabel}</p>
                ) : null}
                <OperatorSteps items={section.steps} />
              </div>
            ) : null}

            {section.outcome ? (
              <OperatorNote label={section.outcomeLabel ?? "Outcome"}>
                <p>{section.outcome}</p>
              </OperatorNote>
            ) : null}

            {section.cta ? <OperatorActions primary={section.cta} /> : null}
          </OperatorBand>
        );
      })}

      <OperatorFinalCta
        title={config.finalCta.title}
        description={config.finalCta.description}
        primary={config.finalCta.primary}
        secondary={config.finalCta.secondary}
      />
    </MarketingShell>
  );
}
