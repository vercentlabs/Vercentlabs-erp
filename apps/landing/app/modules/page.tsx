import Link from "next/link";
import { MODULES_INDEX_PAGE, MODULE_NAV_GROUPS, LANDING_MODULES, getLandingModule } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CollectionHero } from "@/components/shared/collection-hero";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { Reveal } from "@/components/motion/reveal";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: MODULES_INDEX_PAGE.title,
  description: MODULES_INDEX_PAGE.metaDescription,
  path: MODULES_INDEX_PAGE.slug,
});

export default function ModulesIndexPage() {
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: MODULES_INDEX_PAGE.title,
    description: MODULES_INDEX_PAGE.metaDescription,
    url: absoluteUrl(MODULES_INDEX_PAGE.slug),
    hasPart: LANDING_MODULES.map((moduleInfo) => ({
      "@type": "WebPage",
      name: moduleInfo.name,
      url: absoluteUrl(`/modules/${moduleInfo.key}`),
    })),
  };

  return (
    <>
      <TrackView event="modules_index_view">
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container><Breadcrumbs trail={[{ name: "Modules", path: "/modules" }]} /></Container>
        </Section>
        <CollectionHero
          eyebrow={MODULES_INDEX_PAGE.eyebrow}
          heading={MODULES_INDEX_PAGE.heading}
          supportingText={MODULES_INDEX_PAGE.supportingText}
          listLabel="Connected modules"
          items={LANDING_MODULES.map((moduleInfo) => ({ label: moduleInfo.name, meta: moduleInfo.navGroup }))}
          variant="modules"
        />
      </TrackView>

      <Reveal><DirectDefinition definition={MODULES_INDEX_PAGE.directDefinition} /></Reveal>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Module atlas" title="Twelve modules. Five operating territories." description="The map is organised around how work moves through a business: revenue, operations, finance, delivery, and people & service." />
          <div className="mt-10 border-y border-(--color-border-strong)">
            {MODULE_NAV_GROUPS.map((group, groupIndex) => (
              <Reveal key={group.key} group className="grid border-t border-(--color-border-default) py-8 first:border-t-0 lg:grid-cols-[190px_1fr] lg:gap-10 lg:py-10">
                <div className="mb-6 lg:mb-0">
                  <span className="font-mono text-4xl font-semibold leading-none tracking-[-0.06em] text-(--color-border-strong)">{String(groupIndex + 1).padStart(2, "0")}</span>
                  <Text variant="dataLabel" className="mt-3 block">Territory</Text>
                  <p className="mt-1 text-base font-semibold text-(--color-text-primary)">{group.label}</p>
                </div>
                <div className="grid gap-0 md:grid-cols-2">
                  {group.moduleKeys.map((key, index) => {
                    const moduleInfo = getLandingModule(key);
                    if (!moduleInfo) return null;
                    return (
                      <Link
                        key={key}
                        href={`/modules/${moduleInfo.key}`}
                        prefetch={false}
                        data-reveal-item
                        style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}
                        className="group relative border-t border-(--color-border-default) py-6 md:odd:pr-7 md:even:border-l md:even:pl-7"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                          <span className="vl-hover-arrow text-sm text-(--color-text-brand)" aria-hidden="true">→</span>
                        </div>
                        <Text variant="bodySmall" className="mt-4 max-w-[54ch]">{moduleInfo.directDefinition}</Text>
                        <dl className="mt-6 grid grid-cols-2 gap-5 border-t border-(--color-border-default) pt-4">
                          <div>
                            <dt className="vl-index">Primary user</dt>
                            <dd className="mt-1 text-xs font-semibold text-(--color-text-primary)">{moduleInfo.personas[0]}</dd>
                          </div>
                          <div>
                            <dt className="vl-index">Outcome</dt>
                            <dd className="mt-1 text-xs font-semibold text-(--color-text-primary)">{moduleInfo.businessOutcomes[0]?.title}</dd>
                          </div>
                        </dl>
                      </Link>
                    );
                  })}
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <Section tone="subtle" paddingTop={{ base: 12, sm: 16 }} paddingBottom={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Operating stacks" title="Adopt a working system, not a box of apps." description="Module access is entitlement-gated per organisation. These stacks show practical combinations without pretending every buyer needs everything on day one." />
          <Reveal group>
            <div className="mt-10 grid border-l border-t border-(--color-border-strong) md:grid-cols-2">
              {MODULES_INDEX_PAGE.operatingStacks.map((stack, index) => (
                <article key={stack.id} data-reveal-item className="min-h-[260px] border-b border-r border-(--color-border-strong) bg-(--color-bg-elevated) p-6 sm:p-8" style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}>
                  <div className="flex items-start justify-between gap-4">
                    <span className="vl-index">STACK / {String(index + 1).padStart(2, "0")}</span>
                    <span className="font-mono text-2xl font-semibold leading-none text-(--color-text-primary)">{String(stack.moduleKeys.length).padStart(2, "0")}</span>
                  </div>
                  <Heading level="h3" className="mt-8">{stack.name}</Heading>
                  <Text variant="bodySmall" className="mt-3 max-w-[58ch]">{stack.description}</Text>
                  <Inline gap={2} className="mt-6 flex-wrap">
                    {stack.moduleKeys.map((key) => {
                      const moduleInfo = getLandingModule(key);
                      if (!moduleInfo) return null;
                      return <Link key={key} href={`/modules/${key}`} prefetch={false}><ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} /></Link>;
                    })}
                  </Inline>
                </article>
              ))}
            </div>
          </Reveal>
        </Container>
      </Section>

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container>
          <Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[820px]">
              <span className="vl-index text-white/50">MODULE ATLAS / NEXT STEP</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">See which modules fit your operation.</Heading>
            </div>
            <TrackedCtaLink href={MODULES_INDEX_PAGE.primaryCta.href} event="platform_cta_click" ctaLocation="modules_index_final">{MODULES_INDEX_PAGE.primaryCta.label}</TrackedCtaLink>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
