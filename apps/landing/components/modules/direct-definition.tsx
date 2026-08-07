import { Container, Section } from "@/components/layout/container";
import { Text } from "@/components/ui/text";

/**
 * The "what is the Vercentlabs {module} module?" answer, near the top of every
 * module/platform page, always server-rendered (never gated behind client
 * interaction) — the AEO/GEO direct-answer requirement.
 */
export function DirectDefinition({ definition }: { definition: string }) {
  return (
    <Section tone="subtle" className="py-10 sm:py-12">
      <Container>
        <Text variant="bodyLarge" className="max-w-[820px] font-medium">
          {definition}
        </Text>
      </Container>
    </Section>
  );
}
