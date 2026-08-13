import { Container, Section, SplitLayout, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";

interface CollectionHeroItem {
  label: string;
  meta?: string;
}

export function CollectionHero({
  eyebrow,
  heading,
  supportingText,
  items,
  listLabel,
}: {
  eyebrow: string;
  heading: string;
  supportingText: string;
  items: CollectionHeroItem[];
  listLabel: string;
}) {
  return (
    <Section tone="page" paddingTop={{ base: 10, sm: 14 }} paddingBottom={{ base: 12, sm: 16 }}>
      <Container>
        <SplitLayout
          ratio="primary-wide"
          primary={
            <Stack gap={5} className="reveal-on-load max-w-[760px]">
              <Text variant="eyebrow">{eyebrow}</Text>
              <Heading level="display" as="h1">
                {heading}
              </Heading>
              <Text variant="lead">{supportingText}</Text>
            </Stack>
          }
          secondary={
            <div className="reveal-on-load reveal-on-load-delay-1 border-t border-(--color-border-strong)">
              <div className="flex items-end justify-between border-b border-(--color-border-default) py-4">
                <Text variant="caption">{listLabel}</Text>
                <span className="tabular-data text-4xl font-semibold tracking-[-0.04em] text-(--color-text-primary)">
                  {String(items.length).padStart(2, "0")}
                </span>
              </div>
              <ol>
                {items.slice(0, 6).map((item, index) => (
                  <li key={item.label} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-(--color-border-default) py-3.5">
                    <span className="tabular-data text-xs font-medium text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-sm font-medium text-(--color-text-primary)">{item.label}</span>
                    {item.meta ? <span className="text-xs text-(--color-text-muted)">{item.meta}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          }
        />
      </Container>
    </Section>
  );
}
