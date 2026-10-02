import { CONNECTED_ERP_SECTION } from "@vercentlabs/landing-content";
import { Container, Section } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { TrackView } from "@/components/analytics/track-view";

// Each layer's key matches a part of the connected-ERP map above it, so the
// legend glyph mirrors that part: a module tile, the ERP core, the platform.
const LAYER_GLYPH: Record<string, string> = {
  modules: "h-3.5 w-6 border border-(--color-border-strong) bg-(--vl-paper-strong)",
  core: "h-3.5 w-[3px] bg-(--vl-ink)",
  platform: "h-2 w-6 bg-(--vl-brand)",
};

export function HomeConnectedErp() {
  return (
    <TrackView event="connected_erp_view">
      <Section tone="page" paddingTop={{ base: 0 }} paddingBottom={{ base: 14, sm: 16, lg: 20 }}>
        <Container>
          <div className="grid grid-cols-1 gap-8 border-t border-(--color-border-strong) pt-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-x-12 lg:pt-10 xl:gap-x-16">
            <div>
              <Text variant="eyebrow">{CONNECTED_ERP_SECTION.eyebrow}</Text>
              <Heading level="h3" as="h2" className="mt-5 max-w-[22ch]">
                {CONNECTED_ERP_SECTION.heading}
              </Heading>
              <Text variant="bodySmall" className="mt-4 max-w-[58ch]">
                {CONNECTED_ERP_SECTION.supportingText}
              </Text>
            </div>
            <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-3">
              {CONNECTED_ERP_SECTION.layers.map((layer) => (
                <li key={layer.key} className="border-t border-(--color-border-default) py-4 sm:border-t-0 sm:py-0">
                  <span className="flex h-4 items-center" aria-hidden="true">
                    <span className={LAYER_GLYPH[layer.key]} />
                  </span>
                  <h3 className="mt-3 text-[0.95rem] font-semibold tracking-[-0.02em] text-(--color-text-primary)">{layer.label}</h3>
                  <p className="mt-2 text-sm leading-[1.65] text-(--color-text-secondary)">{layer.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
