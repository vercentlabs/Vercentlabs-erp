import Link from "next/link";
import { LANDING_INDUSTRIES } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CollectionHero } from "@/components/shared/collection-hero";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { Reveal } from "@/components/motion/reveal";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Industries",
  description: "See how Vercentlabs ERP runs manufacturing, distribution, retail, and professional-services operations — real module stacks and evidence, not generic ERP copy.",
  path: "/industries",
});

export default function IndustriesIndexPage() {
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Industries",
    description: "Vercentlabs ERP by industry: manufacturing, distribution, retail, and professional services.",
    url: absoluteUrl("/industries"),
    hasPart: LANDING_INDUSTRIES.map((industry) => ({
      "@type": "WebPage",
      name: industry.name,
      url: absoluteUrl(`/industries/${industry.slug}`),
    })),
  };

  return (
    <>
      <TrackView event="industries_index_view">
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container><Breadcrumbs trail={[{ name: "Industries", path: "/industries" }]} /></Container>
        </Section>
        <CollectionHero
          eyebrow="Industries"
          heading="Built for how your industry actually operates."
          supportingText="A real operating model, module stack, and evidence specific to each industry — never generic ERP copy with the industry name swapped in."
          listLabel="Operating models"
          items={LANDING_INDUSTRIES.map((industry) => ({ label: industry.name, meta: `${industry.moduleStack.length} modules` }))}
          variant="industries"
        />
      </TrackView>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Field notes" title="Four businesses. Four different operating pressures." description="Each industry page starts from the operating environment, then maps the modules, controls and evidence that actually matter there." />
          <Reveal group>
            <div className="mt-10 grid border-l border-t border-(--color-border-strong) md:grid-cols-2">
              {LANDING_INDUSTRIES.map((industry, index) => (
                <Link
                  key={industry.slug}
                  href={`/industries/${industry.slug}`}
                  prefetch={false}
                  data-reveal-item
                  style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}
                  className="group relative flex min-h-[360px] flex-col border-b border-r border-(--color-border-strong) bg-(--color-bg-elevated) p-6 transition-colors hover:bg-(--color-bg-subtle) sm:p-8 lg:min-h-[420px] lg:p-10"
                >
                  <div className="flex items-start justify-between gap-6">
                    <span className="font-mono text-6xl font-semibold leading-none tracking-[-0.08em] text-(--color-border-strong)">{String(index + 1).padStart(2, "0")}</span>
                    <span className="vl-index">FIELD / {industry.slug.toUpperCase()}</span>
                  </div>
                  <div className="mt-16 max-w-[620px] lg:mt-24">
                    <Heading level="h2" as="h2" className="max-w-[12ch]">{industry.name}</Heading>
                    <Text variant="body" className="mt-5 max-w-[58ch] text-(--color-text-secondary)">{industry.directDefinition}</Text>
                  </div>
                  <div className="mt-12 flex items-end justify-between gap-6 border-t border-(--color-border-default) pt-4 sm:mt-14 lg:mt-auto">
                    <div className="min-w-0">
                      <span className="vl-index">Primary stack</span>
                      <p className="mt-2 text-xs font-semibold text-(--color-text-primary)">{industry.moduleStack.slice(0, 3).map((entry) => entry.moduleKey).join(" · ")}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-2xl font-semibold leading-none text-(--color-text-primary)">{String(industry.moduleStack.length).padStart(2, "0")}</span>
                      <p className="mt-1 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-(--color-text-muted)">modules</p>
                    </div>
                  </div>
                  <span className="vl-hover-arrow absolute right-6 top-1/2 text-lg text-(--color-text-brand) sm:right-8 lg:right-10" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </Reveal>
        </Container>
      </Section>

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container>
          <Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[820px]">
              <span className="vl-index text-white/50">FIELD SESSION / LIVE</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">See your industry&rsquo;s operating model in a live demo.</Heading>
            </div>
            <TrackedCtaLink href="/book-demo" event="industry_final_cta_click" ctaLocation="industries_index_final">Book a Demo</TrackedCtaLink>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
