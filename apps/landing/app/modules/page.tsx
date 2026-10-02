import Link from "next/link";
import {
  LANDING_MODULES,
  LAUNCH_CAPABILITY_SUMMARY,
  MODULES_INDEX_PAGE,
  getLandingModule,
  getRoutedWorkflows,
} from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TrackView } from "@/components/analytics/track-view";
import { CtaPair } from "@/components/conversion/cta-pair";
import { ModuleGroupColumns } from "@/components/modules/module-group-columns";
import { SharedPlatformBand } from "@/components/platform/shared-platform-band";
import { WorkflowModulePath } from "@/components/workflows/workflow-module-path";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: MODULES_INDEX_PAGE.title,
  description: MODULES_INDEX_PAGE.metaDescription,
  path: MODULES_INDEX_PAGE.slug,
});

export default function ModulesIndexPage() {
  const page = MODULES_INDEX_PAGE;
  // Relationships come from the documented workflows; modules outside every
  // multi-module workflow show the handoffs their own content describes.
  const crossModuleWorkflows = getRoutedWorkflows().filter((workflow) => new Set(workflow.sequence?.map((step) => step.moduleKey)).size > 1);
  const inWorkflows = new Set(crossModuleWorkflows.flatMap((workflow) => workflow.sequence?.map((step) => step.moduleKey) ?? []));
  const otherConnections = LANDING_MODULES.filter((landingModule) => !inWorkflows.has(landingModule.key)).flatMap((landingModule) =>
    landingModule.connectedModules.slice(0, 2).flatMap((link) => {
      const target = getLandingModule(link.moduleKey);
      return target ? [{ from: landingModule, target, relationship: link.relationship }] : [];
    }),
  );

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: page.title,
    description: page.metaDescription,
    url: absoluteUrl(page.slug),
    hasPart: LANDING_MODULES.map((moduleInfo) => ({ "@type": "WebPage", name: moduleInfo.displayName, url: absoluteUrl(`/modules/${moduleInfo.key}`) })),
  };

  return (
    <>
      <TrackView event="modules_index_view">
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container>
            <Breadcrumbs trail={[{ name: "Modules", path: "/modules" }]} />
          </Container>
        </Section>
        <Section tone="page" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 10, sm: 12 }}>
          <Container>
            <div className="reveal-on-load grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
              <div>
                <Text variant="eyebrow">{page.eyebrow}</Text>
                <Heading level="h1" className="mt-5 max-w-[16ch]">
                  {page.heading}
                </Heading>
              </div>
              <div>
                <Text variant="lead">{page.supportingText}</Text>
                <p className="mt-4 text-sm font-semibold text-(--color-text-primary)">{LAUNCH_CAPABILITY_SUMMARY}.</p>
              </div>
            </div>
          </Container>
        </Section>
      </TrackView>

      <Section tone="page" paddingTop={{ base: 0 }}>
        <Container>
          <SectionHeader eyebrow={page.groupsSection.eyebrow} title={page.groupsSection.heading} description={page.groupsSection.supportingText} />
          <ModuleGroupColumns className="mt-12" />
        </Container>
      </Section>

      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow={page.relationshipsSection.eyebrow} title={page.relationshipsSection.heading} description={page.relationshipsSection.supportingText} />
          <ul className="mt-10 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {crossModuleWorkflows.map((workflow) => (
              <li key={workflow.slug} className="border border-(--color-border-strong) bg-(--vl-paper-strong) p-5">
                <Link href={`/workflows/${workflow.slug}`} prefetch={false} className="group inline-flex items-center gap-2 text-base font-semibold text-(--color-text-primary) hover:text-(--color-text-brand)">
                  {workflow.name}
                  <span className="vl-hover-arrow text-(--color-text-muted)" aria-hidden="true">→</span>
                </Link>
                <WorkflowModulePath slug={workflow.slug} className="mt-3" />
              </li>
            ))}
          </ul>
          {otherConnections.length ? (
            <ul className="mt-6 grid grid-cols-1 gap-x-10 md:grid-cols-2" aria-label="Other module connections">
              {otherConnections.map(({ from, target, relationship }) => (
                <li key={`${from.key}-${target.key}`} className="border-t border-(--color-border-default) py-4">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-(--color-text-primary)">
                    <Link href={`/modules/${from.key}`} prefetch={false} className="hover:text-(--color-text-brand)">
                      {from.displayName}
                    </Link>
                    <span className="text-(--color-text-muted)" aria-hidden="true">
                      →
                    </span>
                    <span className="sr-only">connects to</span>
                    <Link href={`/modules/${target.key}`} prefetch={false} className="hover:text-(--color-text-brand)">
                      {target.displayName}
                    </Link>
                  </p>
                  <p className="mt-1 text-sm leading-[1.6] text-(--color-text-secondary)">{relationship}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </Container>
      </Section>

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow={page.platformSection.eyebrow} title={page.platformSection.heading} description={page.platformSection.supportingText} />
          <SharedPlatformBand className="mt-10" />
        </Container>
      </Section>

      <Section tone="page" paddingTop={{ base: 0 }}>
        <Container>
          <SectionHeader eyebrow={page.stacksSection.eyebrow} title={page.stacksSection.heading} description={page.stacksSection.supportingText} />
          <ul className="mt-10 grid grid-cols-1 gap-px bg-(--color-border-strong) md:grid-cols-2">
            {page.operatingStacks.map((stack) => (
              <li key={stack.id} className="bg-(--vl-paper-strong) p-6">
                <h3 className="text-lg font-semibold tracking-[-0.03em] text-(--color-text-primary)">{stack.name}</h3>
                <p className="mt-2 max-w-[60ch] text-sm leading-[1.6] text-(--color-text-secondary)">{stack.description}</p>
                <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                  {stack.moduleKeys.map((key) => {
                    const landingModule = getLandingModule(key);
                    return landingModule ? (
                      <li key={key}>
                        <Link href={`/modules/${key}`} prefetch={false} className="inline-flex items-center gap-1.5 text-[0.82rem] font-semibold text-(--color-text-primary) hover:text-(--color-text-brand)">
                          <span className="h-2 w-2" style={{ backgroundColor: landingModule.accentColor.hex }} aria-hidden="true" />
                          {landingModule.displayName}
                        </Link>
                      </li>
                    ) : null;
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section tone="inverse" className="vl-noise-free">
        <Container>
          <div className="grid grid-cols-1 items-end gap-8 border-t border-white/20 pt-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
            <div>
              <Heading level="h2" className="max-w-[20ch] text-white">
                {page.finalCta.heading}
              </Heading>
              <p className="mt-4 max-w-[60ch] text-sm leading-[1.65] text-white/75">{page.finalCta.supportingText}</p>
            </div>
            <CtaPair
              ctaLocation="modules_index_final"
              primary={{ href: page.finalCta.primaryCta.href, event: "module_related_link_click", label: page.finalCta.primaryCta.label, variant: "inverse" }}
              secondary={{ href: page.finalCta.secondaryCta.href, event: "platform_cta_click", label: page.finalCta.secondaryCta.label, variant: "inverse-secondary" }}
            />
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
