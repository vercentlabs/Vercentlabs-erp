import { notFound } from "next/navigation";
import Link from "next/link";
import { LANDING_SOLUTIONS, getSolution, getLandingModule, getWorkflow, PLATFORM_PAGES, PRODUCT_OVERVIEW_PAGE } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { PlatformHero } from "@/components/platform/platform-hero";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { BeforeAfterSystem } from "@/components/solutions/before-after-system";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { Reveal } from "@/components/motion/reveal";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

interface LinkedPlatformPage { slug: string; title: string; directDefinition: string; }
const PLATFORM_PAGES_BY_SLUG = new Map<string, LinkedPlatformPage>([[PRODUCT_OVERVIEW_PAGE.slug, PRODUCT_OVERVIEW_PAGE], ...PLATFORM_PAGES.map((page): [string, LinkedPlatformPage] => [page.slug, page])]);

export function generateStaticParams() { return LANDING_SOLUTIONS.map((solution) => ({ slug: solution.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const solution = getSolution(slug);
  if (!solution) return {};
  return buildPageMetadata({ title: solution.name, description: solution.metaDescription, path: `/solutions/${solution.slug}` });
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const solution = getSolution(slug);
  if (!solution) notFound();
  const relatedModules = solution.relatedModuleKeys.map((key) => getLandingModule(key)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const relatedWorkflows = solution.relatedWorkflowSlugs.map((s) => getWorkflow(s)).filter((w): w is NonNullable<typeof w> => Boolean(w));
  const platformPage = PLATFORM_PAGES_BY_SLUG.get(solution.relatedPlatformPageSlug);
  const breadcrumbTrail = [{ name: "Solutions", path: "/solutions" }, { name: solution.name, path: `/solutions/${solution.slug}` }];
  const webPageJsonLd = { "@context": "https://schema.org", "@type": "WebPage", name: `${solution.name} — Vercentlabs ERP`, description: solution.metaDescription, url: absoluteUrl(`/solutions/${solution.slug}`), isPartOf: { "@id": SOFTWARE_APPLICATION_ID } };
  const faqPageJsonLd = solution.faqs.length > 0 ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: solution.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) } : null;

  return (
    <>
      <TrackView event="solution_page_view" properties={{ section: solution.slug }}>
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}><Container><Breadcrumbs trail={breadcrumbTrail} /></Container></Section>
        <PlatformHero
          eyebrow="Solution"
          heading={solution.name}
          supportingText={solution.problemStatement}
          connectedModuleKeys={solution.relatedModuleKeys}
          ctaHref={`/book-demo?solution=${solution.slug}`}
          ctaLabel={solution.conversion.ctaLabel}
          ctaEvent="solution_cta_click"
          ctaLocation={`solution_hero_${solution.slug}`}
          variant="solution"
        />
      </TrackView>

      <Reveal><DirectDefinition definition={solution.directDefinition} /></Reveal>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <div className="grid gap-8 lg:grid-cols-[180px_1fr] lg:gap-12">
            <div className="border-t border-(--color-border-strong) pt-4"><span className="vl-index">DIAGNOSTIC / 01</span><p className="mt-3 text-sm font-semibold text-(--color-text-primary)">State change</p></div>
            <div><SectionHeader title="Before and after" description="The solution is presented as a change in operating state: what fails today, and what replaces it when the system is connected." className="border-t-0 pt-0 lg:grid-cols-1" /><Reveal><div className="mt-8"><BeforeAfterSystem before={solution.before} after={solution.after} /></div></Reveal></div>
          </div>
        </Container>
      </Section>

      <Section tone="subtle" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <div className="grid gap-8 lg:grid-cols-[180px_1fr] lg:gap-12">
            <div className="border-t border-(--color-border-strong) pt-4"><span className="vl-index">DIAGNOSTIC / 02</span><p className="mt-3 text-sm font-semibold text-(--color-text-primary)">Intervention</p></div>
            <div>
              <SectionHeader title="What replaces the problem" description="Each intervention is a concrete operating mechanism, not an aspirational benefit statement." className="border-t-0 pt-0 lg:grid-cols-1" />
              <Reveal group>
                <ol className="mt-8 border-y border-(--color-border-strong)">
                  {solution.approach.map((item, index) => (
                    <li key={item.title} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 50}ms` }} className="grid gap-4 border-t border-(--color-border-default) py-5 first:border-t-0 sm:grid-cols-[54px_minmax(190px,.55fr)_minmax(0,1fr)] sm:gap-6">
                      <span className="font-mono text-xl font-semibold text-(--vl-signal)">{String(index + 1).padStart(2, "0")}</span>
                      <p className="text-sm font-semibold text-(--color-text-primary)">{item.title}</p>
                      <p className="text-sm leading-relaxed text-(--color-text-secondary)">{item.description}</p>
                    </li>
                  ))}
                </ol>
              </Reveal>
            </div>
          </div>
        </Container>
      </Section>

      {platformPage ? (
        <Section tone="page" paddingTop={{ base: 10, sm: 12 }} paddingBottom={{ base: 10, sm: 12 }}>
          <Container>
            <Reveal className="grid gap-6 border-y border-(--color-border-strong) py-7 sm:grid-cols-[160px_minmax(220px,.55fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-8">
              <span className="vl-index">UNDERLYING CAPABILITY</span>
              <Heading level="h3">{platformPage.title}</Heading>
              <Text variant="bodySmall">{platformPage.directDefinition}</Text>
              <Link href={platformPage.slug} prefetch={false} className="text-sm font-semibold text-(--color-text-brand) vl-editorial-link">Open capability →</Link>
            </Reveal>
          </Container>
        </Section>
      ) : null}

      <ContextualCta prompt="Ready to see this running on your own data?" href={`/book-demo?solution=${solution.slug}`} event="solution_cta_click" ctaLocation={`solution_mid_${solution.slug}`} />

      <Section tone="subtle" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="System map" title="Where the intervention lives." description="The problem may look like one process, but the solution usually spans several modules and at least one cross-module workflow." />
          <Reveal group>
            <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1fr]">
              <div className="border-y border-(--color-border-strong) py-5">
                <span className="vl-index">Modules</span>
                <div className="mt-5 flex flex-wrap gap-2">
                  {relatedModules.map((moduleInfo, index) => (
                    <Link key={moduleInfo.key} href={`/modules/${moduleInfo.key}`} prefetch={false} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 50}ms` }}><ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} /></Link>
                  ))}
                </div>
              </div>
              <div className="border-y border-(--color-border-strong) py-5">
                <span className="vl-index">Workflows</span>
                <ol className="mt-4">
                  {relatedWorkflows.map((workflow) => (
                    <li key={workflow.slug} className="border-t border-(--color-border-default) first:border-t-0"><Link href={`/workflows/${workflow.slug}`} prefetch={false} data-reveal-item className="group flex items-center justify-between gap-4 py-3"><span className="text-sm font-semibold text-(--color-text-primary)">{workflow.name}</span><span className="vl-hover-arrow text-(--color-text-brand)">→</span></Link></li>
                  ))}
                </ol>
              </div>
            </div>
          </Reveal>
        </Container>
      </Section>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container><SectionHeader eyebrow="Buyer questions" title="Questions buyers ask" description="Direct answers about fit, scope and how this solution behaves in the real system." /><Reveal group><FaqAccordion items={solution.faqs} className="mt-10 max-w-[900px]" /></Reveal></Container>
      </Section>

      <Section tone="subtle" paddingTop={{ base: 10, sm: 12 }} paddingBottom={{ base: 10, sm: 12 }}>
        <Container><div className="grid gap-7 border-y border-(--color-border-strong) py-7 lg:grid-cols-[180px_1fr] lg:gap-12"><Text variant="dataLabel">Related diagnostics</Text><Stack gap={4}><RelatedPages pages={[{ label: "See the implementation journey", href: "/implementation" }, { label: "See all solutions", href: "/solutions" }]} /></Stack></div></Container>
      </Section>

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container><Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12"><div className="max-w-[820px]"><span className="vl-index text-white/50">DIAGNOSTIC → LIVE SYSTEM</span><Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">{solution.conversion.heading}</Heading></div><TrackedCtaLink href={`/book-demo?solution=${solution.slug}`} event="solution_cta_click" ctaLocation={`solution_final_${solution.slug}`}>{solution.conversion.ctaLabel}</TrackedCtaLink></Reveal></Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
