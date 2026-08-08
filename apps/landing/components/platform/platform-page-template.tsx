import Link from "next/link";
import type { PlatformPageContent } from "@vercentlabs/landing-content";
import { getLandingModule } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Heading } from "@/components/ui/text";
import { LabeledItemGrid } from "@/components/ui/labeled-item-grid";
import { ModuleTag } from "@/components/ui/tag";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import type { BreadcrumbEntry } from "@/lib/seo/json-ld";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { PlatformHero } from "@/components/platform/platform-hero";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";

/**
 * One shared template rendering any of the 6 approved platform pages
 * (/product/platform, /product/automation, /product/analytics,
 * /product/mobile, /product/integrations, /security) from typed content in
 * packages/landing-content/src/platform-pages.js. Shared structure, not
 * shared copy — every page's content is distinct (see
 * docs/landing-redesign/phase-4/page-differentiation-matrix.md).
 */
export function PlatformPageTemplate({ content, breadcrumbTrail }: { content: PlatformPageContent; breadcrumbTrail: BreadcrumbEntry[] }) {
  const faqPageJsonLd =
    content.faqs && content.faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: content.faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        }
      : null;

  return (
    <>
      <TrackView event="platform_page_view" properties={{ workflow: content.slug }}>
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container>
            <Breadcrumbs trail={breadcrumbTrail} />
          </Container>
        </Section>

        <PlatformHero
          eyebrow={content.eyebrow}
          heading={content.heading}
          supportingText={content.supportingText}
          heroScreenshotId={content.heroScreenshotId}
          connectedModuleKeys={content.connectedModuleKeys}
          ctaHref={content.primaryCta.href}
          ctaLabel={content.primaryCta.label}
          ctaEvent="platform_cta_click"
          ctaLocation={`platform_hero_${content.slug}`}
        />
      </TrackView>

      <DirectDefinition definition={content.directDefinition} />

      {content.sections.map((section, index) => (
        <Section key={section.id} tone={index % 2 === 0 ? "page" : "subtle"}>
          <Container>
            <SectionHeader eyebrow={section.eyebrow} title={section.heading} description={section.supportingText} />
            {section.items.length > 0 ? (
              <div className="mt-10">
                <LabeledItemGrid items={section.items} />
              </div>
            ) : null}
          </Container>
        </Section>
      ))}

      <Section tone="elevated" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 8, sm: 10 }}>
        <Container>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-base font-medium text-(--color-text-primary)">See {content.title} running in a live demo.</p>
            <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation={`platform_mid_${content.slug}`} variant="secondary">
              {content.primaryCta.label}
            </TrackedCtaLink>
          </div>
        </Container>
      </Section>

      {content.connectedModuleKeys.length > 0 ? (
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow="Where this shows up" title="Modules built on this capability" />
            <div className="mt-6 flex flex-wrap gap-2">
              {content.connectedModuleKeys.map((key) => {
                const moduleInfo = getLandingModule(key);
                if (!moduleInfo) return null;
                return (
                  <Link key={key} href={`/modules/${key}`} prefetch={false}>
                    <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                  </Link>
                );
              })}
            </div>
          </Container>
        </Section>
      ) : null}

      {content.faqs && content.faqs.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="Straight answers" title="Questions buyers ask" />
            <FaqAccordion items={content.faqs} className="mt-10 max-w-[820px]" />
          </Container>
        </Section>
      ) : null}

      <Section tone="inverse">
        <Container>
          <div className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              {content.finalCtaHeading}
            </Heading>
            <div className="mt-6 flex justify-center">
              <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation={`platform_final_${content.slug}`}>
                {content.primaryCta.label}
              </TrackedCtaLink>
            </div>
          </div>
        </Container>
      </Section>

      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
