import { POSITIONING, CTAS, LANDING_MODULES } from "@vercentlabs/landing-content";
import { Container, Section, Stack, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ButtonLink } from "@/components/ui/button";
import { ModuleTag } from "@/components/ui/tag";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: `${POSITIONING.heroHeadline}`,
  description: POSITIONING.heroSubhead,
  path: "/",
});

/**
 * TEMPORARY Phase 2 homepage — proves the global shell (header, mega menu, mobile
 * nav, footer, design tokens) works end to end. The full 12-section homepage from
 * docs/landing-redesign/phase-1/homepage-blueprint.md is Phase 3 scope. This page
 * is intentionally minimal, truthful, and indexable (see phase-2-brief.md /
 * implementation-summary.md).
 */
export default function HomePage() {
  return (
    <Section tone="page" className="pt-16 sm:pt-20">
      <Container>
        <Stack gap={6} className="max-w-[760px]">
          <Text variant="eyebrow">Vercentlabs ERP</Text>
          <Heading level="display">{POSITIONING.heroHeadline}</Heading>
          <Text variant="lead">{POSITIONING.heroSubhead}</Text>
          <Inline gap={3}>
            <ButtonLink href={CTAS.primary.href}>{CTAS.primary.label}</ButtonLink>
            <ButtonLink href={CTAS.exploreProduct.href} variant="secondary">
              {CTAS.exploreProduct.label}
            </ButtonLink>
          </Inline>
        </Stack>

        <div className="mt-16 border-t border-(--color-border-default) pt-10">
          <Text variant="dataLabel">Twelve modules, one system</Text>
          <div className="mt-4 flex flex-wrap gap-2">
            {LANDING_MODULES.map((module) => (
              <ModuleTag key={module.key} name={module.name} accentColor={module.accentColor.hex} />
            ))}
          </div>
        </div>

        <div className="mt-16 max-w-[640px] rounded-(--radius-panel) border border-dashed border-(--color-border-strong) p-6">
          <Text variant="label">The full homepage is being built next.</Text>
          <Text variant="bodySmall" className="mt-2">
            This page currently validates the production scaffold, design system, and global navigation shipped in
            Phase 2 of the redesign programme. The complete homepage narrative — problem framing, connected-platform
            explanation, workflow demonstration, security, and implementation sections — arrives in Phase 3. See{" "}
            <a href="/design-system" className="text-(--color-text-link) underline underline-offset-2">
              /design-system
            </a>{" "}
            for the full component library.
          </Text>
        </div>
      </Container>
    </Section>
  );
}
