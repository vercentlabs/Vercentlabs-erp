import Link from "next/link";
import {
  LANDING_MODULES,
  LAUNCH_CAPABILITY_COUNTS,
  MODULE_NAV_GROUPS,
  PLATFORM_FOUNDATION_SECTION,
  PRODUCT_OVERVIEW_PAGE,
  getLandingModule,
  getRoutedWorkflows,
  type LandingModule,
} from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackView } from "@/components/analytics/track-view";
import { CtaPair } from "@/components/conversion/cta-pair";
import { EvaluationPaths } from "@/components/conversion/evaluation-paths";
import { ConnectedErpMap } from "@/components/product/connected-erp-map";
import { ProductEvidence } from "@/components/product/product-evidence";
import { SystemArchitecture } from "@/components/product/system-architecture";
import { WorkflowModulePath } from "@/components/workflows/workflow-module-path";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";

export const metadata = buildPageMetadata({ title: PRODUCT_OVERVIEW_PAGE.title, description: PRODUCT_OVERVIEW_PAGE.metaDescription, path: PRODUCT_OVERVIEW_PAGE.slug });

const WIDE_SIZES = "(min-width: 1480px) 1380px, (min-width: 1024px) calc(100vw - 96px), 100vw";

function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} prefetch={false} className="group inline-flex items-center gap-2 text-sm font-semibold text-(--color-text-brand)">
      <span className="vl-editorial-link">{label}</span>
      <span className="vl-hover-arrow" aria-hidden="true">
        →
      </span>
    </Link>
  );
}

export default function ProductOverviewPage() {
  const page = PRODUCT_OVERVIEW_PAGE;
  const modules = MODULE_NAV_GROUPS.flatMap((group) => group.moduleKeys)
    .map((key) => getLandingModule(key))
    .filter((landingModule): landingModule is LandingModule => landingModule !== null);
  const workflows = getRoutedWorkflows();
  const faqPageJsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: page.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) };

  return (
    <>
      <TrackView event="platform_page_view" properties={{ workflow: "product-overview" }}>
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container>
            <Breadcrumbs trail={[{ name: "Product", path: "/product" }]} />
          </Container>
        </Section>
        {/* 1. What it is. */}
        <Section tone="page" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 10, sm: 14 }}>
          <Container>
            <div className="reveal-on-load grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.6fr)] lg:items-end lg:gap-16">
              <div>
                <Text variant="eyebrow">{page.eyebrow}</Text>
                <Heading level="h1" className="mt-5 max-w-[18ch]">
                  {page.heading}
                </Heading>
                <Text variant="lead" className="mt-6">
                  {page.supportingText}
                </Text>
                <CtaPair
                  className="mt-8"
                  ctaLocation="product_overview_hero"
                  primary={{ href: page.primaryCta.href, event: "platform_cta_click", label: page.primaryCta.label }}
                  secondary={{ href: page.secondaryCta.href, event: "platform_cta_click", label: page.secondaryCta.label, variant: "secondary" }}
                />
              </div>
              <dl className="grid grid-cols-3 border-t border-(--color-border-strong) lg:grid-cols-1">
                {page.facts.map((fact) => (
                  <div key={fact.label} className="grid content-start border-b border-(--color-border-default) py-3 pr-3 lg:grid-cols-[4.5rem_1fr] lg:items-baseline lg:pr-0">
                    <dt className="mt-1 text-[0.78rem] leading-snug text-(--color-text-secondary) sm:text-sm lg:mt-0">{fact.label}</dt>
                    <dd className="tabular-data -order-1 text-2xl font-semibold leading-none tracking-[-0.05em] text-(--color-text-primary) sm:text-[1.75rem]">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* 2. How the system is structured. */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow={page.architecture.eyebrow} title={page.architecture.heading} description={page.architecture.supportingText} />
          <div className="mt-12">
            <SystemArchitecture />
          </div>
        </Container>
      </Section>

      {/* 3. What it looks like: one strong, current product screen. */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow={page.evidence.eyebrow} title={page.evidence.heading} description={page.evidence.supportingText} />
          <ProductEvidence className="mt-10" screenshotId={page.evidence.primaryScreenshotId} sizes={WIDE_SIZES} fallback={<ConnectedErpMap className="mt-10" />} />
        </Container>
      </Section>

      {/* 4. The modules, each with its job, scope and one connection. */}
      <Section tone="page" paddingTop={{ base: 0 }}>
        <Container>
          <SectionHeader eyebrow={page.modulesSection.eyebrow} title={page.modulesSection.heading} description={page.modulesSection.supportingText} />
          <ul className="mt-10 grid grid-cols-1 gap-px bg-(--color-border-default) sm:grid-cols-2 xl:grid-cols-3">
            {modules.map((landingModule) => {
              const connection = landingModule.connectedModules[0];
              const target = connection ? getLandingModule(connection.moduleKey) : null;
              return (
                <li key={landingModule.key} className="bg-(--color-bg-page)">
                  <Link href={`/modules/${landingModule.key}`} prefetch={false} className="group flex h-full flex-col border-t-[3px] p-5 hover:bg-(--vl-paper-strong)" style={{ borderTopColor: landingModule.accentColor.hex }}>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-lg font-semibold tracking-[-0.03em] text-(--color-text-primary)">{landingModule.displayName}</span>
                      <span className="vl-index">{LAUNCH_CAPABILITY_COUNTS[landingModule.key]} capabilities</span>
                    </span>
                    <span className="mt-2 text-sm leading-[1.55] text-(--color-text-secondary)">{landingModule.purpose}</span>
                    {target ? (
                      <span className="mt-auto flex items-center gap-2 pt-4 text-[0.8rem] font-semibold text-(--color-text-primary)">
                        <span className="text-(--color-text-muted)" aria-hidden="true">
                          →
                        </span>
                        Connects to {target.displayName}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex justify-end">
            <SectionLink href="/modules" label={`See all ${LANDING_MODULES.length} modules`} />
          </div>
        </Container>
      </Section>

      {/* 5. How work moves: the documented workflows as module handoff paths. */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow={page.workflowsSection.eyebrow} title={page.workflowsSection.heading} description={page.workflowsSection.supportingText} />
          <ul className="mt-10 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {workflows.map((workflow) => (
              <li key={workflow.slug} className="flex flex-col border border-(--color-border-strong) bg-(--vl-paper-strong) p-5">
                <h3 className="text-lg font-semibold tracking-[-0.03em] text-(--color-text-primary)">{workflow.name}</h3>
                <WorkflowModulePath slug={workflow.slug} className="mt-3" />
                <div className="mt-auto pt-4">
                  <SectionLink href={`/workflows/${workflow.slug}`} label="See the complete workflow" />
                </div>
              </li>
            ))}
          </ul>
          <ProductEvidence className="mt-10 max-w-[1100px]" screenshotId={page.evidence.secondaryScreenshotId} sizes="(min-width: 1180px) 1100px, 100vw" fallback={null} />
        </Container>
      </Section>

      {/* 6. The Shared Platform underneath every module. */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow={page.platformSection.eyebrow} title={page.platformSection.heading} description={page.platformSection.supportingText} />
          <ul className="mt-10 grid grid-cols-1 gap-px bg-(--color-border-default) md:grid-cols-2 xl:grid-cols-3">
            {PLATFORM_FOUNDATION_SECTION.families.map((family) => (
              <li key={family.key} className="bg-(--color-bg-page) p-5">
                <h3 className="text-base font-semibold tracking-[-0.025em] text-(--color-text-primary)">{family.title}</h3>
                <p className="mt-1.5 text-sm leading-[1.6] text-(--color-text-secondary)">{family.description}</p>
                <p className="mt-3 text-[0.8rem] leading-[1.55] text-(--color-text-primary)">{family.capabilities.join(" · ")}</p>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-end">
            <SectionLink href={page.platformSection.cta.href} label={page.platformSection.cta.label} />
          </div>
        </Container>
      </Section>

      {/* 7. How to evaluate it. */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow={page.evaluation.eyebrow} title={page.evaluation.heading} />
          <div className="mt-10">
            <EvaluationPaths locationPrefix="product_evaluation" omitHref={page.slug} />
          </div>
        </Container>
      </Section>

      {/* 8. Trust and control. */}
      <Section tone="inverse" className="vl-noise-free">
        <Container>
          <div className="grid grid-cols-1 gap-10 border-t border-white/25 pt-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:gap-14">
            <div>
              <p className="vl-kicker vl-kicker-inverse">{page.controlsSection.eyebrow}</p>
              <Heading level="h2" className="mt-5 max-w-[18ch] text-white">
                {page.controlsSection.heading}
              </Heading>
              <Link href={page.controlsSection.cta.href} prefetch={false} className="group mt-6 inline-flex items-center gap-2 text-sm font-semibold text-white">
                <span className="vl-editorial-link">{page.controlsSection.cta.label}</span>
                <span className="vl-hover-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </div>
            <ul className="grid grid-cols-1 border-t border-white/20 sm:grid-cols-2">
              {page.controlsSection.items.map((item) => (
                <li key={item.title} className="border-b border-white/15 py-4 sm:pr-6">
                  <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                  <p className="mt-1.5 text-[0.85rem] leading-[1.6] text-white/75">{item.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      {/* 9. Buyer questions. */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow={page.faqSection.eyebrow} title={page.faqSection.heading} />
          <FaqAccordion items={page.faqs} className="mt-10 max-w-[900px]" />
        </Container>
      </Section>

      {/* 10. Next step. */}
      <Section tone="brand" className="text-white">
        <Container>
          <div className="grid grid-cols-1 items-end gap-8 border-t border-white/35 pt-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
            <div>
              <Heading level="h2" className="max-w-[20ch] text-white">
                {page.finalCta.heading}
              </Heading>
              <p className="mt-4 max-w-[60ch] text-base leading-[1.7] text-white/80">{page.finalCta.supportingText}</p>
            </div>
            <CtaPair
              ctaLocation="product_overview_final"
              primary={{ href: page.finalCta.primaryCta.href, event: "platform_cta_click", label: page.finalCta.primaryCta.label, variant: "inverse" }}
              secondary={{ href: page.finalCta.secondaryCta.href, event: "platform_cta_click", label: page.finalCta.secondaryCta.label, variant: "inverse-secondary" }}
            />
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(faqPageJsonLd)} />
    </>
  );
}
