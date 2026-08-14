import Link from "next/link";
import { LANDING_MODULES, PRODUCT_OVERVIEW_PAGE } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { PlatformHero } from "@/components/platform/platform-hero";
import { Reveal } from "@/components/motion/reveal";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";

export const metadata = buildPageMetadata({ title: PRODUCT_OVERVIEW_PAGE.title, description: PRODUCT_OVERVIEW_PAGE.metaDescription, path: PRODUCT_OVERVIEW_PAGE.slug });

export default function ProductOverviewPage() {
  const faqPageJsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: PRODUCT_OVERVIEW_PAGE.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) };

  return (
    <>
      <TrackView event="platform_page_view" properties={{ workflow: "product-overview" }}>
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}><Container><Breadcrumbs trail={[{ name: "Product", path: "/product" }]} /></Container></Section>
        <PlatformHero
          eyebrow={PRODUCT_OVERVIEW_PAGE.eyebrow}
          heading={PRODUCT_OVERVIEW_PAGE.heading}
          supportingText={PRODUCT_OVERVIEW_PAGE.supportingText}
          connectedModuleKeys={LANDING_MODULES.map((moduleInfo) => moduleInfo.key)}
          ctaHref={PRODUCT_OVERVIEW_PAGE.primaryCta.href}
          ctaLabel={PRODUCT_OVERVIEW_PAGE.primaryCta.label}
          ctaEvent="platform_cta_click"
          ctaLocation="product_overview_hero"
          variant="product"
        />
      </TrackView>

      <Reveal><DirectDefinition definition={PRODUCT_OVERVIEW_PAGE.directDefinition} /></Reveal>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }} paddingBottom={{ base: 10, sm: 14 }}>
        <Container>
          <div className="grid gap-8 border-y border-(--color-border-strong) py-7 lg:grid-cols-[180px_1fr] lg:gap-12">
            <span className="vl-index">PLATFORM MAP / 12</span>
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              {LANDING_MODULES.map((moduleInfo, index) => (
                <Link key={moduleInfo.key} href={`/modules/${moduleInfo.key}`} prefetch={false} className="group flex items-center gap-2 border-b border-(--color-border-default) pb-2">
                  <span className="vl-index" style={{ color: moduleInfo.accentColor.hex }}>{String(index + 1).padStart(2, "0")}</span>
                  <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                </Link>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {PRODUCT_OVERVIEW_PAGE.sections.map((section, sectionIndex) => (
        <Section key={section.id} tone={sectionIndex % 2 === 0 ? "page" : "subtle"} paddingTop={{ base: 12, sm: 16 }} paddingBottom={{ base: 12, sm: 16 }}>
          <Container>
            <div className="grid gap-8 lg:grid-cols-[180px_1fr] lg:gap-12">
              <div className="border-t border-(--color-border-strong) pt-4">
                <span className="font-mono text-4xl font-semibold leading-none tracking-[-0.06em] text-(--color-border-strong)">{String(sectionIndex + 1).padStart(2, "0")}</span>
                <Text variant="dataLabel" className="mt-3 block">{section.eyebrow}</Text>
              </div>
              <div>
                <SectionHeader title={section.heading} description={section.supportingText} className="border-t-0 pt-0 lg:grid-cols-1" />
                {section.items && section.items.length > 0 ? (
                  <Reveal group>
                    <div className="mt-8 border-y border-(--color-border-strong)">
                      {section.items.map((item, itemIndex) => (
                        <div key={item.title} data-reveal-item style={{ transitionDelay: `${Math.min(itemIndex, 4) * 50}ms` }} className="grid gap-4 border-t border-(--color-border-default) py-5 first:border-t-0 sm:grid-cols-[50px_minmax(180px,.55fr)_minmax(0,1fr)] sm:gap-6 sm:py-6">
                          <span className="vl-index text-(--color-text-brand)">{String(itemIndex + 1).padStart(2, "0")}</span>
                          <p className="text-sm font-semibold text-(--color-text-primary)">{item.title}</p>
                          <p className="text-sm leading-relaxed text-(--color-text-secondary)">{item.description}</p>
                        </div>
                      ))}
                    </div>
                  </Reveal>
                ) : null}
              </div>
            </div>
          </Container>
        </Section>
      ))}

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Buyer questions" title="Questions about the system, answered without theatre." description="Platform scope, architecture and deployment questions sit here so buyers can inspect the system before a demo." />
          <Reveal group><FaqAccordion items={PRODUCT_OVERVIEW_PAGE.faqs} className="mt-10 max-w-[900px]" /></Reveal>
        </Container>
      </Section>

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container>
          <Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[820px]">
              <span className="vl-index text-white/50">PLATFORM MAP → LIVE SYSTEM</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">See the connected platform in a live demo.</Heading>
            </div>
            <TrackedCtaLink href={PRODUCT_OVERVIEW_PAGE.primaryCta.href} event="platform_cta_click" ctaLocation="product_overview_final">{PRODUCT_OVERVIEW_PAGE.primaryCta.label}</TrackedCtaLink>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(faqPageJsonLd)} />
    </>
  );
}
