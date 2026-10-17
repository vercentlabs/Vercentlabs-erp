import { notFound } from "next/navigation";
import { LANDING_INDUSTRIES, getIndustry, getLandingModule, getWorkflow, getBuyerRolesBySlugs } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
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

export function generateStaticParams() { return LANDING_INDUSTRIES.map((industry) => ({ slug: industry.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) return {};
  return buildPageMetadata({ title: `${industry.name} ERP`, description: industry.metaDescription, path: `/industries/${industry.slug}` });
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) notFound();

  const primaryWorkflow = industry.primaryWorkflowSlug ? getWorkflow(industry.primaryWorkflowSlug) : null;
  const buyerRoles = getBuyerRolesBySlugs(industry.buyerRoleSlugs);
  const breadcrumbTrail = [{ name: "Industries", path: "/industries" }, { name: industry.name, path: `/industries/${industry.slug}` }];
  const webPageJsonLd = { "@context": "https://schema.org", "@type": "WebPage", name: `${industry.name} — Vercentlabs ERP`, description: industry.metaDescription, url: absoluteUrl(`/industries/${industry.slug}`), isPartOf: { "@id": SOFTWARE_APPLICATION_ID } };
  const faqPageJsonLd = industry.faqs.length > 0 ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: industry.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) } : null;

  return (
    <>
      <TrackView event="industry_page_view" properties={{ industry: industry.slug }}>
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}><Container><Breadcrumbs trail={breadcrumbTrail} /></Container></Section>
        <PlatformHero
          eyebrow="Industry"
          heading={`Vercentlabs ERP for ${industry.name}`}
          supportingText={industry.directDefinition}
          connectedModuleKeys={industry.moduleStack.map((entry) => entry.moduleKey)}
          ctaHref={`/book-demo?industry=${industry.slug}`}
          ctaLabel={industry.conversion.ctaLabel}
          ctaEvent="industry_final_cta_click"
          ctaLocation={`industry_hero_${industry.slug}`}
          variant="industry"
        />
      </TrackView>

      <Reveal><DirectDefinition definition={industry.operatingModel} /></Reveal>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <div className="grid gap-8 lg:grid-cols-[180px_1fr] lg:gap-12">
            <div className="border-t border-(--color-border-strong) pt-4">
              <span className="vl-index">FIELD NOTE / 01</span>
              <p className="mt-3 text-sm font-semibold text-(--color-text-primary)">Operating pressure register</p>
            </div>
            <div>
              <SectionHeader title={`What makes ${industry.name.toLowerCase()} operations hard without a connected system`} className="border-t-0 pt-0 lg:grid-cols-1" />
              <Reveal group>
                <ol className="mt-8 border-y border-(--color-border-strong)">
                  {industry.challenges.map((challenge, index) => (
                    <li key={challenge} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 50}ms` }} className="grid gap-4 border-t border-(--color-border-default) py-5 first:border-t-0 sm:grid-cols-[54px_1fr] sm:gap-6">
                      <span className="font-mono text-xl font-semibold text-(--vl-signal)">{String(index + 1).padStart(2, "0")}</span>
                      <p className="max-w-[72ch] text-base leading-relaxed text-(--color-text-primary)">{challenge}</p>
                    </li>
                  ))}
                </ol>
              </Reveal>
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="subtle" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Operating stack" title="Which modules carry the work, and why." description="This is the actual module stack for the operating model—not a generic list of everything the ERP happens to contain." />
          <Reveal><div className="mt-10"><RecommendedModuleStack entries={industry.moduleStack} resolveModule={(key) => getLandingModule(key) ?? undefined} /></div></Reveal>
        </Container>
      </Section>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <div className="grid gap-8 lg:grid-cols-[180px_1fr] lg:gap-12">
            <div className="border-t border-(--color-border-strong) pt-4">
              <span className="vl-index">FIELD NOTE / 03</span>
              <p className="mt-3 text-sm font-semibold text-(--color-text-primary)">Evidence ledger</p>
            </div>
            <div>
              <SectionHeader title="What's real today" description="Claims on this page stay bounded to implemented or evidenced capability. The ledger makes those claims inspectable instead of burying them in marketing paragraphs." className="border-t-0 pt-0 lg:grid-cols-1" />
              <Reveal group>
                <ol className="mt-8 border-y border-(--color-border-strong)">
                  {industry.evidenceHighlights.map((claim, index) => (
                    <li key={claim} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 50}ms` }} className="grid gap-4 border-t border-(--color-border-default) py-5 first:border-t-0 sm:grid-cols-[54px_110px_1fr] sm:gap-6">
                      <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                      <span className="vl-index">VERIFIED</span>
                      <p className="text-sm leading-relaxed text-(--color-text-primary)">{claim}</p>
                    </li>
                  ))}
                </ol>
              </Reveal>
            </div>
          </div>
        </Container>
      </Section>

      {buyerRoles.length > 0 ? (
        <Section tone="subtle" paddingTop={{ base: 12, sm: 16 }}>
          <Container>
            <SectionHeader eyebrow="Decision room" title="Different buyers inspect different risks." description="The same system reads differently to operators, finance, leadership and implementation owners. This section keeps those perspectives explicit." />
            <Reveal><div className="mt-10"><RolePerspective roles={buyerRoles} /></div></Reveal>
          </Container>
        </Section>
      ) : null}

      <ContextualCta prompt={`Ready to see ${industry.name} running on your own data?`} href={`/book-demo?industry=${industry.slug}`} event="industry_final_cta_click" ctaLocation={`industry_mid_${industry.slug}`} />

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Buyer questions" title={`Questions ${industry.name.toLowerCase()} buyers ask`} description="Direct answers to the operational questions that usually surface once an industry-specific ERP evaluation becomes serious." />
          <Reveal group><FaqAccordion items={industry.faqs} className="mt-10 max-w-[900px]" /></Reveal>
        </Container>
      </Section>

      <Section tone="subtle" paddingTop={{ base: 10, sm: 12 }} paddingBottom={{ base: 10, sm: 12 }}>
        <Container>
          <div className="grid gap-7 border-y border-(--color-border-strong) py-7 lg:grid-cols-[180px_1fr] lg:gap-12">
            <Text variant="dataLabel">Related field notes</Text>
            <Stack gap={4}><RelatedPages pages={[...(primaryWorkflow ? [{ label: `${primaryWorkflow.name} workflow`, href: `/workflows/${primaryWorkflow.slug}` }] : []), { label: "See the implementation journey", href: "/implementation" }, { label: "Security & governance", href: "/security" }, { label: "See all industries", href: "/industries" }]} /></Stack>
          </div>
        </Container>
      </Section>

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container>
          <Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[820px]">
              <span className="vl-index text-white/50">FIELD NOTE → LIVE OPERATING MODEL</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">{industry.conversion.heading}</Heading>
            </div>
            <TrackedCtaLink href={`/book-demo?industry=${industry.slug}`} event="industry_final_cta_click" ctaLocation={`industry_final_${industry.slug}`}>{industry.conversion.ctaLabel}</TrackedCtaLink>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
