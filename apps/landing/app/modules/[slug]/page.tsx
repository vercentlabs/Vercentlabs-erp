import { notFound } from "next/navigation";
import Link from "next/link";
import {
  CTAS,
  LANDING_MODULES,
  LAUNCH_CAPABILITY_COUNTS,
  MODULE_DETAIL_PAGE,
  getIndustriesForModule,
  getLandingModule,
  getResourceGuidesForModule,
  getRoutedWorkflowsForModule,
} from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackView } from "@/components/analytics/track-view";
import { CtaPair } from "@/components/conversion/cta-pair";
import { ModuleHero } from "@/components/modules/module-hero";
import { ModuleProcess } from "@/components/modules/module-process";
import { CapabilityGrid } from "@/components/modules/capability-grid";
import { ConnectedModules } from "@/components/modules/connected-modules";
import { RelatedPages } from "@/components/modules/related-pages";
import { ProductEvidence } from "@/components/product/product-evidence";
import { SharedPlatformBand } from "@/components/platform/shared-platform-band";
import { WorkflowModulePath } from "@/components/workflows/workflow-module-path";
import { Heading } from "@/components/ui/text";
import { getApprovedScreenshot } from "@/lib/product/screenshots";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export function generateStaticParams() {
  return LANDING_MODULES.map((landingModule) => ({ slug: landingModule.key }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const landingModule = getLandingModule(slug);
  if (!landingModule) return {};
  return buildPageMetadata({
    title: `${landingModule.displayName} Module`,
    description: landingModule.metaDescription,
    path: `/modules/${landingModule.key}`,
  });
}

const SCREENSHOT_SIZES = "(min-width: 1480px) 1380px, (min-width: 1024px) calc(100vw - 96px), 100vw";

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const landingModule = getLandingModule(slug);
  if (!landingModule) notFound();

  const name = landingModule.displayName;
  const accent = landingModule.accentColor.hex;
  const workflows = getRoutedWorkflowsForModule(landingModule.key);
  const primaryShot = landingModule.screenshots.primary;
  const secondaryShot = landingModule.screenshots.secondary;
  const hasScreenshot = Boolean(primaryShot && getApprovedScreenshot(primaryShot));
  const relatedPages = [
    ...workflows.slice(0, 2).map((workflow) => ({ label: `${workflow.name} workflow`, href: `/workflows/${workflow.slug}` })),
    ...landingModule.connectedModules.slice(0, 2).flatMap((link) => {
      const connected = getLandingModule(link.moduleKey);
      return connected ? [{ label: `${connected.displayName} module`, href: `/modules/${connected.key}` }] : [];
    }),
    ...getIndustriesForModule(landingModule.key).slice(0, 1).map((industry) => ({ label: `${name} in ${industry.name.toLowerCase()}`, href: `/industries/${industry.slug}` })),
    ...[...getResourceGuidesForModule(landingModule.key)].sort((a, b) => a.relatedModuleKeys.length - b.relatedModuleKeys.length).slice(0, 1).map((guide) => ({ label: guide.title, href: `/resources/${guide.slug}` })),
    { label: "All 12 modules", href: "/modules" },
  ];
  const finalExplore = workflows[0]
    ? { href: `/workflows/${workflows[0].slug}`, label: `See the ${workflows[0].name} workflow` }
    : { href: "/workflows", label: "Explore connected workflows" };

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${name} — Vercentlabs ERP`,
    description: landingModule.metaDescription,
    url: absoluteUrl(`/modules/${landingModule.key}`),
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
  };
  const faqPageJsonLd = landingModule.faqs.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: landingModule.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
      }
    : null;

  return (
    <>
      <TrackView event="module_page_view" properties={{ workflow: landingModule.key }}>
        <div>
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={[{ name: "Modules", path: "/modules" }, { name, path: `/modules/${landingModule.key}` }]} />
            </Container>
          </Section>
          <ModuleHero landingModule={landingModule} />
        </div>
      </TrackView>

      {/* 2. Product evidence: a current, approved screen, or the module's process as a labelled diagram. */}
      <Section tone="page" paddingTop={{ base: 0 }} paddingBottom={{ base: 14, sm: 16 }}>
        <Container>
          <p className="vl-index mb-3">{MODULE_DETAIL_PAGE.evidenceEyebrow}</p>
          <div className={secondaryShot && hasScreenshot ? "grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:items-start" : undefined}>
            <ProductEvidence screenshotId={primaryShot} moduleAccentColor={accent} sizes={SCREENSHOT_SIZES} fallback={<ModuleProcess landingModule={landingModule} />} />
            {secondaryShot && hasScreenshot ? <ProductEvidence screenshotId={secondaryShot} moduleAccentColor={accent} sizes="(min-width: 1440px) 560px, 100vw" fallback={null} /> : null}
          </div>
        </Container>
      </Section>

      {/* 3. What the module manages. */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow={MODULE_DETAIL_PAGE.managesEyebrow} title={MODULE_DETAIL_PAGE.managesHeading(name)} />
          <ul className="mt-10 grid grid-cols-1 gap-px bg-(--color-border-strong) md:grid-cols-2">
            {landingModule.businessOutcomes.map((item, index) => (
              <li key={item.title} className="bg-(--vl-paper-strong) p-6 sm:p-7">
                <span className="vl-index" style={{ color: accent }}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 text-lg font-semibold tracking-[-0.03em] text-(--color-text-primary)">{item.title}</h3>
                <p className="mt-2 max-w-[60ch] text-sm leading-[1.65] text-(--color-text-secondary)">{item.description}</p>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* 4. Every approved capability, from the register, in buyer-readable groups. */}
      <Section tone="page" id="capabilities">
        <Container>
          <SectionHeader
            eyebrow={MODULE_DETAIL_PAGE.capabilitiesEyebrow}
            title={MODULE_DETAIL_PAGE.capabilitiesHeading(name, LAUNCH_CAPABILITY_COUNTS[landingModule.key])}
            description={MODULE_DETAIL_PAGE.capabilitiesSupportingText}
          />
          <div className="mt-10">
            <CapabilityGrid groups={landingModule.capabilityGroups} />
          </div>
        </Container>
      </Section>

      {/* 5. The connected workflow(s) this module takes part in, or its own process. */}
      {workflows.length || hasScreenshot ? (
        <TrackView event="module_workflow_view" properties={{ workflow: workflows[0]?.slug ?? landingModule.primaryWorkflow.name }}>
          <Section tone="subtle">
            <Container>
              <SectionHeader eyebrow={MODULE_DETAIL_PAGE.workflowEyebrow} title={MODULE_DETAIL_PAGE.workflowHeading(name)} />
              {workflows.length ? (
                <ul className="mt-10 grid gap-4">
                  {workflows.slice(0, 3).map((workflow, index) => (
                    <li key={workflow.slug} className="border border-(--color-border-strong) bg-(--vl-paper-strong) p-5 sm:p-6">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                        <h3 className={index === 0 ? "text-xl font-semibold tracking-[-0.035em]" : "text-base font-semibold tracking-[-0.025em]"}>{workflow.name}</h3>
                        <Link href={`/workflows/${workflow.slug}`} prefetch={false} className="group inline-flex items-center gap-2 text-sm font-semibold text-(--color-text-brand)">
                          <span className="vl-editorial-link">See the complete workflow</span>
                          <span className="vl-hover-arrow" aria-hidden="true">→</span>
                        </Link>
                      </div>
                      {index === 0 ? <p className="mt-2 max-w-[78ch] text-sm leading-[1.6] text-(--color-text-secondary)">{workflow.summary}</p> : null}
                      <WorkflowModulePath slug={workflow.slug} highlightModuleKey={landingModule.key} showSteps={index === 0} className="mt-4" />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-10">
                  <ModuleProcess landingModule={landingModule} />
                </div>
              )}
            </Container>
          </Section>
        </TrackView>
      ) : null}

      {/* 6. Connections to other modules. */}
      {landingModule.connectedModules.length ? (
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={MODULE_DETAIL_PAGE.connectionsEyebrow} title={MODULE_DETAIL_PAGE.connectionsHeading(name)} />
            <div className="mt-10">
              <ConnectedModules landingModule={landingModule} />
            </div>
          </Container>
        </Section>
      ) : null}

      {/* 7. Shared Platform controls this module inherits. */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow={MODULE_DETAIL_PAGE.platformEyebrow} title={MODULE_DETAIL_PAGE.platformHeading} description={MODULE_DETAIL_PAGE.platformSupportingText} />
          <ul className="mt-10 grid grid-cols-1 gap-x-10 md:grid-cols-3">
            {landingModule.governance.map((item) => (
              <li key={item.title} className="border-t border-(--color-border-strong) py-5">
                <h3 className="text-base font-semibold tracking-[-0.025em] text-(--color-text-primary)">{item.title}</h3>
                <p className="mt-2 text-sm leading-[1.6] text-(--color-text-secondary)">{item.description}</p>
              </li>
            ))}
          </ul>
          <SharedPlatformBand className="mt-6" />
        </Container>
      </Section>

      {/* 8. Buyer questions. */}
      {landingModule.faqs.length > 0 ? (
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={MODULE_DETAIL_PAGE.faqEyebrow} title={MODULE_DETAIL_PAGE.faqHeading(name)} />
            <FaqAccordion items={landingModule.faqs} className="mt-10 max-w-[900px]" />
          </Container>
        </Section>
      ) : null}

      {/* 9. Related exploration. */}
      <Section tone="page" paddingTop={{ base: 0 }} paddingBottom={{ base: 14, sm: 16 }}>
        <Container>
          <p className="vl-index mb-4">{MODULE_DETAIL_PAGE.relatedEyebrow}</p>
          <RelatedPages pages={relatedPages} />
        </Container>
      </Section>

      {/* 10. Next step: keep exploring, or talk to a specialist. */}
      <Section tone="inverse" className="vl-noise-free">
        <Container>
          <div className="grid grid-cols-1 items-end gap-8 border-t border-white/20 pt-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
            <Heading level="h2" className="max-w-[24ch] text-white">
              {landingModule.conversion.heading}
            </Heading>
            <CtaPair
              ctaLocation={`module_final_${landingModule.key}`}
              primary={{ href: finalExplore.href, event: "module_related_link_click", label: finalExplore.label, variant: "inverse" }}
              secondary={{ href: `/book-demo?module=${landingModule.key}`, event: "module_final_cta_click", label: CTAS.talkToSpecialist.label, variant: "inverse-secondary" }}
            />
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
