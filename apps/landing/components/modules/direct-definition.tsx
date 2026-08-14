import { Container, Section } from "@/components/layout/container";
import { Text } from "@/components/ui/text";

export function DirectDefinition({ definition }: { definition: string }) {
  return (
    <Section tone="page" paddingTop={{ base: 7, sm: 9 }} paddingBottom={{ base: 7, sm: 9 }}>
      <Container>
        <div className="grid gap-4 border-y border-(--color-border-strong) py-6 lg:grid-cols-[190px_minmax(0,820px)] lg:gap-8 lg:py-7">
          <Text variant="eyebrow">What it is</Text>
          <Text variant="bodyLarge" className="font-semibold tracking-[-0.02em]">{definition}</Text>
        </div>
      </Container>
    </Section>
  );
}
