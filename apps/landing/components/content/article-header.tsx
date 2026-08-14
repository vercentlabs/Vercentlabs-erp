import { cx } from "@/lib/utils";
import { Container, Section } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ContentFreshnessMeta } from "@/components/content/content-freshness";
import type { ContentAuthor, ContentFreshness } from "@vercentlabs/landing-content";

export type ArticleHeaderVariant = "resource" | "glossary" | "comparison" | "generic";

export function ArticleHeader({
  eyebrow,
  title,
  dek,
  author,
  freshness,
  className,
  variant = "resource",
}: {
  eyebrow: string;
  title: string;
  dek: string;
  author: ContentAuthor;
  freshness: ContentFreshness;
  className?: string;
  variant?: ArticleHeaderVariant;
}) {
  if (variant === "glossary") {
    return (
      <Section tone="page" paddingTop={{ base: 8, sm: 12 }} paddingBottom={{ base: 12, sm: 16 }} className={cx(className)}>
        <Container>
          <article className="border-t border-(--color-border-strong) pt-5">
            <div className="flex items-center justify-between gap-4">
              <Text variant="eyebrow">{eyebrow}</Text>
              <span className="vl-folio">LEXICON / TERM</span>
            </div>
            <div className="mt-8 grid gap-8 lg:grid-cols-[140px_minmax(0,1.2fr)_minmax(300px,.65fr)] lg:items-end lg:gap-10">
              <div className="hidden lg:block">
                <span className="font-mono text-[6rem] font-semibold leading-[0.7] tracking-[-0.1em] text-(--color-border-strong)" aria-hidden="true">Aa</span>
                <span className="vl-index mt-5 block">Definition sheet</span>
              </div>
              <Heading level="display" as="h1" className="max-w-[10ch]">{title}</Heading>
              <div className="border-l border-(--color-border-strong) pl-5 sm:pl-7">
                <Text variant="lead">{dek}</Text>
                <div className="mt-6 border-t border-(--color-border-default) pt-4">
                  <ContentFreshnessMeta author={author} freshness={freshness} />
                </div>
              </div>
            </div>
          </article>
        </Container>
      </Section>
    );
  }

  if (variant === "comparison") {
    return (
      <Section tone="page" paddingTop={{ base: 8, sm: 12 }} paddingBottom={{ base: 12, sm: 16 }} className={cx(className)}>
        <Container>
          <article className="border-t border-(--color-border-strong) pt-5">
            <div className="flex items-center justify-between gap-4">
              <Text variant="eyebrow">{eyebrow}</Text>
              <span className="vl-folio">DECISION DOCKET / VERIFIED</span>
            </div>
            <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)] lg:items-end lg:gap-16">
              <div>
                <span className="vl-index">SIDE A / SIDE B / SOURCED DIFFERENCE</span>
                <Heading level="display" as="h1" className="mt-4 max-w-[12ch]">{title}</Heading>
              </div>
              <div>
                <div className="border-y border-(--color-border-strong) py-5">
                  <Text variant="lead">{dek}</Text>
                </div>
                <div className="mt-5">
                  <ContentFreshnessMeta author={author} freshness={freshness} />
                </div>
              </div>
            </div>
            <div className="mt-10 grid grid-cols-3 border-y border-(--color-border-strong) py-4 text-center">
              <div className="border-r border-(--color-border-default)"><span className="vl-index">01 / Evidence</span></div>
              <div className="border-r border-(--color-border-default)"><span className="vl-index">02 / Fit</span></div>
              <div><span className="vl-index">03 / Trade-off</span></div>
            </div>
          </article>
        </Container>
      </Section>
    );
  }

  return (
    <Section tone="page" paddingTop={{ base: 8, sm: 12 }} paddingBottom={{ base: 12, sm: 18 }} className={cx(className)}>
      <Container>
        <article className="border-t border-(--color-border-strong) pt-5">
          <div className="flex items-center justify-between gap-4">
            <Text variant="eyebrow">{eyebrow}</Text>
            <span className="vl-index">REFERENCE / VERIFIED</span>
          </div>
          <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)] lg:items-end lg:gap-16">
            <div>
              <span className="vl-index">VLC / FIELD REFERENCE / {freshness.lastReviewedAt}</span>
              <Heading level="display" as="h1" className="mt-4 max-w-[12ch]">{title}</Heading>
            </div>
            <div className="border-l border-(--color-border-strong) pl-5 sm:pl-7">
              <Text variant="lead" className="max-w-[58ch]">{dek}</Text>
              <div className="mt-7 border-t border-(--color-border-default) pt-4">
                <ContentFreshnessMeta author={author} freshness={freshness} />
              </div>
            </div>
          </div>
        </article>
      </Container>
    </Section>
  );
}
