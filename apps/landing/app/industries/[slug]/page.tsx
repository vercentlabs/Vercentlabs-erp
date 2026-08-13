import { notFound } from "next/navigation";
import { LANDING_INDUSTRIES, getIndustry, getLandingModule, getWorkflow, getBuyerRolesBySlugs } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { LabeledItemGrid } from "@/components/ui/labeled-item-grid";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { PlatformHero } from "@/components/platform/platform-hero";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { RecommendedModuleStack } from "@/components/industries/recommended-module-stack";
import { RolePerspective } from "@/components/shared/role-perspective";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { Reveal } from "@/components/motion/reveal";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export function generateStaticParams() {
  return LANDING_INDUSTRIES.map((industry) => ({ slug: industry.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) return {};
  return buildPageMetadata({
    title: `${industry.name} ERP`,
    description: industry.metaDescription,
    path: `/industries/${industry.slug}`,
  });
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) notFound();

  const primaryWorkflow = industry.primaryWorkflowSlug ? getWorkflow(industry.primaryWorkflowSlug) : null;
  const buyerRoles = getBuyerRolesBySlugs(industry.buyerRoleSlugs);

  const breadcrumbTrail = [
    { name: "Industries", path: "/industries" },
    { name: industry.name, path: `/industries/${industry.slug}` },
  ];

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${industry.name} — Vercentlabs ERP`,
    description: industry.metaDescription,
    url: absoluteUrl(`/industries/${industry.slug}`),
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
  };

  const faqPageJsonLd =
    industry.faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: industry.faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        }
      : null;

  return (
    <>
      <TrackView event="industry_page_view" properties={{ industry: industry.slug }}>
        {/* Header is a sticky h-16 (4rem) bar — this wrapper fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <div>
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={breadcrumbTrail} />
            </Container>
          </Section>

          <PlatformHero
            eyebrow="Industry"
            heading={`Vercentlabs ERP for ${industry.name}`}
            supportingText={industry.directDefinition}
            heroScreenshotId={industry.screenshots.primary}
            connectedModuleKeys={industry.moduleStack.map((entry) => entry.moduleKey)}
            ctaHref={`/book-demo?industry=${industry.slug}`}
            ctaLabel={industry.conversion.ctaLabel}
            ctaEvent="industry_final_cta_click"
            ctaLocation={`industry_hero_${industry.slug}`}
          />
        </div>
      </TrackView>

      <Reveal>
        <DirectDefinition definition={industry.operatingModel} />
      </Reveal>

      {/* Challenges */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="The real pain" title={`What makes ${industry.name.toLowerCase()} operations hard without a connected system`} />
          <Reveal group>
            <div className="mt-10">
              <LabeledItemGrid items={industry.challenges.map((challenge) => ({ title: challenge, description: "" }))} columns={2} reveal />
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* Module stack */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow="The real module stack" title="Which modules, and why" />
          <Reveal>
            <div className="mt-10">
              <RecommendedModuleStack entries={industry.moduleStack} resolveModule={(key) => getLandingModule(key) ?? undefined} />
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* Evidence highlights */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Evidence, not a pitch" title="What's real today" />
          <Reveal group>
            <ul className="mt-10 flex flex-col gap-4">
              {industry.evidenceHighlights.map((claim, index) => (
                <li
                  key={claim}
                  data-reveal-item
                  style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}
                  className="border-t border-(--color-border-default) pt-4 text-base leading-relaxed text-(--color-text-primary) first:border-t-0 first:pt-0"
                >
                  {claim}
                </li>
              ))}
            </ul>
          </Reveal>
        </Container>
      </Section>

      {buyerRoles.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="Who this is for" title="What each buyer in the room actually cares about" />
            <Reveal>
              <div className="mt-10">
                <RolePerspective roles={buyerRoles} />
              </div>
            </Reveal>
          </Container>
        </Section>
      ) : null}

      <ContextualCta
        prompt={`Ready to see ${industry.name} running on your own data?`}
        href={`/book-demo?industry=${industry.slug}`}
        event="industry_final_cta_click"
        ctaLocation={`industry_mid_${industry.slug}`}
      />

      {/* FAQs */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Straight answers" title={`Questions ${industry.name.toLowerCase()} buyers ask`} />
          <Reveal group>
            <FaqAccordion items={industry.faqs} className="mt-10 max-w-[820px]" />
          </Reveal>
        </Container>
      </Section>

      {/* Related pages */}
      <Section tone="subtle">
        <Container>
          <Stack gap={4}>
            <Text variant="label">Related pages</Text>
            <RelatedPages
              pages={[
                ...(primaryWorkflow ? [{ label: `${primaryWorkflow.name} workflow`, href: `/workflows/${primaryWorkflow.slug}` }] : []),
                { label: "See the implementation journey", href: "/implementation" },
                { label: "Security & governance", href: "/security" },
                { label: "See all industries", href: "/industries" },
              ]}
            />
          </Stack>
        </Container>
      </Section>

      {/* Final CTA */}
      <Section tone="inverse">
        <Container>
          <Reveal className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              {industry.conversion.heading}
            </Heading>
            <div className="mt-6 flex justify-center">
              <Inline gap={3}>
                <TrackedCtaLink href={`/book-demo?industry=${industry.slug}`} event="industry_final_cta_click" ctaLocation={`industry_final_${industry.slug}`}>
                  {industry.conversion.ctaLabel}
                </TrackedCtaLink>
              </Inline>
            </div>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
