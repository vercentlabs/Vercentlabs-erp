import { Container, Section } from "@/components/layout/container";
import { Text } from "@/components/ui/text";

/**
 * The "what is the Vercentlabs {module} module?" answer, near the top of every
 * module/platform page, always server-rendered (never gated behind client
 * interaction) — the AEO/GEO direct-answer requirement.
 */
export function DirectDefinition({ definition }: { definition: string }) {
  return (
    <Section tone="page" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 8, sm: 10 }}>
      <Container>
        <div className="grid grid-cols-1 gap-4 border-t border-(--color-border-default) pt-8 lg:grid-cols-[220px_minmax(0,820px)] lg:gap-12">
          <Text variant="eyebrow">What it is</Text>
          <Text variant="body" className="font-medium">{definition}</Text>
        </div>
      </Container>
    </Section>
  );
}
