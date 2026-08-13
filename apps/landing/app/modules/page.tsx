import Link from "next/link";
import { MODULES_INDEX_PAGE, MODULE_NAV_GROUPS, LANDING_MODULES, getLandingModule } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Inline, Grid } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { InformationBand, BorderedPanel } from "@/components/ui/card";
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
        {/* Header is a sticky h-16 (4rem) bar — this wrapper fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <div>
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={[{ name: "Modules", path: "/modules" }]} />
            </Container>
          </Section>

          <CollectionHero
            eyebrow={MODULES_INDEX_PAGE.eyebrow}
            heading={MODULES_INDEX_PAGE.heading}
            supportingText={MODULES_INDEX_PAGE.supportingText}
            listLabel="Connected modules"
            items={LANDING_MODULES.map((moduleInfo) => ({ label: moduleInfo.name, meta: moduleInfo.navGroup }))}
          />
        </div>
      </TrackView>

      <Reveal>
        <DirectDefinition definition={MODULES_INDEX_PAGE.directDefinition} />
      </Reveal>

      {/* Category-grouped module list */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="The complete map" title="Twelve modules, five operational categories." description="Grouped the way your teams actually think about the business — not by internal engineering structure." />
          <div className="mt-10 flex flex-col">
            {MODULE_NAV_GROUPS.map((group) => (
              <Reveal key={group.key} group className="block border-t border-(--color-border-default) py-8 first:border-t-0 first:pt-0">
                <Text variant="label">{group.label}</Text>
                <div className="mt-4 flex flex-col">
                  {group.moduleKeys.map((key, index) => {
                    const moduleInfo = getLandingModule(key);
                    if (!moduleInfo) return null;
                    return (
                      <InformationBand key={key} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}>
                        <div className="sm:w-2/5">
                          <Link href={`/modules/${moduleInfo.key}`} prefetch={false}>
                            <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                          </Link>
                          <Text variant="bodySmall" className="mt-2 max-w-[46ch]">
                            {moduleInfo.directDefinition}
                          </Text>
                        </div>
                        <div className="sm:w-1/5">
                          <Text variant="caption">Primary users</Text>
                          <Text variant="bodySmall" className="mt-1">
                            {moduleInfo.personas[0]}
                          </Text>
                        </div>
                        <div className="sm:w-1/4">
                          <Text variant="caption">Outcome</Text>
                          <Text variant="bodySmall" className="mt-1">
                            {moduleInfo.businessOutcomes[0]?.title}
                          </Text>
                        </div>
                        <Link href={`/modules/${moduleInfo.key}`} prefetch={false} className="flex-none text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4">
                          View module →
                        </Link>
                      </InformationBand>
                    );
                  })}
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* Operating stacks */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow="Adopt what you need" title="Real operating stacks, not a generic bundle." description="Module access is entitlement-gated per organisation — start with the modules your operation actually needs." />
          <Reveal group>
            <Grid columns={2} gap={6} className="mt-10" reveal>
              {MODULES_INDEX_PAGE.operatingStacks.map((stack) => (
                <BorderedPanel key={stack.id}>
                  <Heading level="h3">{stack.name}</Heading>
                  <Text variant="bodySmall" className="mt-2">
                    {stack.description}
                  </Text>
                  <Inline gap={2} className="mt-4 flex-wrap">
                    {stack.moduleKeys.map((key) => {
                      const moduleInfo = getLandingModule(key);
                      if (!moduleInfo) return null;
                      return (
                        <Link key={key} href={`/modules/${key}`} prefetch={false}>
                          <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                        </Link>
                      );
                    })}
                  </Inline>
                </BorderedPanel>
              ))}
            </Grid>
          </Reveal>
        </Container>
      </Section>

      {/* Final CTA */}
      <Section tone="inverse">
        <Container>
          <Reveal className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              See which modules fit your operation.
            </Heading>
            <div className="mt-6 flex justify-center">
              <TrackedCtaLink href={MODULES_INDEX_PAGE.primaryCta.href} event="platform_cta_click" ctaLocation="modules_index_final">
                {MODULES_INDEX_PAGE.primaryCta.label}
              </TrackedCtaLink>
            </div>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
