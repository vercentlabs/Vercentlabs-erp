import Link from "next/link";
import { LANDING_SOLUTIONS } from "@vercentlabs/landing-content";
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
  title: "Solutions",
  description: "Real business problems Vercentlabs ERP solves — replacing spreadsheets, connecting operations, running multiple companies, automating governed workflows, and real-time reporting.",
  path: "/solutions",
});

export default function SolutionsIndexPage() {
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Solutions",
    description: "Vercentlabs ERP by business problem, not just by module or industry.",
    url: absoluteUrl("/solutions"),
    hasPart: LANDING_SOLUTIONS.map((solution) => ({
      "@type": "WebPage",
      name: solution.name,
      url: absoluteUrl(`/solutions/${solution.slug}`),
    })),
  };

  return (
    <>
      <TrackView event="solutions_index_view">
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container><Breadcrumbs trail={[{ name: "Solutions", path: "/solutions" }]} /></Container>
        </Section>
        <CollectionHero
          eyebrow="Solutions"
          heading="Five real business problems, five real answers."
          supportingText="Each solution starts from the actual operating problem, then shows the connected capability that resolves it."
          listLabel="Business outcomes"
          items={LANDING_SOLUTIONS.map((solution) => ({ label: solution.name }))}
          variant="solutions"
        />
      </TrackView>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Diagnostic register" title="Start with the failure mode, not the software category." description="These are operating problems buyers can recognise immediately. Each case file explains the intervention, the systems involved and the evidence behind it." />
          <Reveal group>
            <ol className="mt-10 border-y border-(--color-border-strong)">
              {LANDING_SOLUTIONS.map((solution, index) => (
                <li key={solution.slug} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}>
                  <Link href={`/solutions/${solution.slug}`} prefetch={false} className="group grid gap-5 border-t border-(--color-border-default) py-7 first:border-t-0 sm:grid-cols-[72px_minmax(240px,.8fr)_minmax(0,1.2fr)_auto] sm:items-start sm:gap-7 sm:py-9">
                    <span className="font-mono text-3xl font-semibold leading-none tracking-[-0.06em] text-(--vl-signal)">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <span className="vl-index">Problem file</span>
                      <Heading level="h3" className="mt-2 group-hover:text-(--color-text-brand)">{solution.name}</Heading>
                    </div>
                    <div className="border-l-[3px] border-l-(--vl-signal) pl-5">
                      <Text variant="bodySmall">{solution.problemStatement}</Text>
                    </div>
                    <span className="vl-hover-arrow pt-1 text-lg text-(--color-text-brand)" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ol>
          </Reveal>
        </Container>
      </Section>

      <Section tone="subtle" paddingTop={{ base: 12, sm: 16 }} paddingBottom={{ base: 12, sm: 16 }}>
        <Container>
          <div className="grid gap-8 border-y border-(--color-border-strong) py-8 lg:grid-cols-[170px_1fr] lg:gap-12">
            <div><span className="vl-index">Method / 01</span></div>
            <div className="grid gap-8 md:grid-cols-3">
              {[
                ["Observe", "Name the operating failure in plain business terms."],
                ["Connect", "Map the modules, workflow and shared controls that change it."],
                ["Verify", "Show only capability that has real product or implementation evidence."],
              ].map(([title, copy], index) => (
                <div key={title} className="border-t border-(--color-border-default) pt-4">
                  <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                  <p className="mt-3 text-base font-semibold text-(--color-text-primary)">{title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container>
          <Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[820px]">
              <span className="vl-index text-white/50">DIAGNOSTIC SESSION / LIVE</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">See your real problem solved in a live demo.</Heading>
            </div>
            <TrackedCtaLink href="/book-demo" event="solution_cta_click" ctaLocation="solutions_index_final">Book a Demo</TrackedCtaLink>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
