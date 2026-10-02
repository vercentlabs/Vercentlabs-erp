import type { CSSProperties } from "react";
import { SECURITY_SECTION } from "@vercentlabs/landing-content";
import { Container, Section } from "@/components/layout/container";
import { Heading } from "@/components/ui/text";
import { ButtonLink } from "@/components/ui/button";
import { TrackView } from "@/components/analytics/track-view";

/** A control chain as an ordered list: each node's label, then what it does. */
function ControlChain({ title, nodes }: { title: string; nodes: { label: string; detail: string }[] }) {
  return (
    <div>
      <p className="vl-index vl-index-inverse">{title}</p>
      <ol className="mt-3 grid grid-cols-1 gap-px bg-white/20 sm:grid-cols-[repeat(var(--chain-count),minmax(0,1fr))]" style={{ "--chain-count": nodes.length } as CSSProperties}>
        {nodes.map((node, index) => (
          <li key={node.label} className="relative bg-(--vl-night) p-4">
            <span className="flex items-center gap-2">
              <span className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-white">{node.label}</span>
              <span className={index < nodes.length - 1 ? "ml-auto text-white/55" : "invisible ml-auto"} aria-hidden="true">
                <span className="hidden sm:inline">→</span>
                <span className="sm:hidden">↓</span>
              </span>
            </span>
            <p className="mt-2 text-[0.82rem] leading-[1.55] text-white/72">{node.detail}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HomeSecurity() {
  return (
    <TrackView event="security_section_view">
      <Section tone="inverse" className="vl-noise-free">
        <Container>
          <div className="grid grid-cols-1 gap-10 border-t border-white/25 pt-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] lg:gap-14">
            <div>
              <p className="vl-kicker vl-kicker-inverse">{SECURITY_SECTION.eyebrow}</p>
              <Heading level="h2" className="mt-6 max-w-[13ch] text-white">
                {SECURITY_SECTION.heading}
              </Heading>
              <p className="mt-5 max-w-[46ch] text-sm leading-[1.68] text-white/72">{SECURITY_SECTION.supportingText}</p>
              <ButtonLink href={SECURITY_SECTION.cta.href} variant="inverse" prefetch={false} className="mt-8">
                {SECURITY_SECTION.cta.label}
              </ButtonLink>
            </div>

            <div className="grid gap-8">
              <ControlChain title="Access" nodes={SECURITY_SECTION.accessChain} />
              <ControlChain title="Traceability" nodes={SECURITY_SECTION.traceChain} />
              <ul className="grid grid-cols-1 border-t border-white/20 sm:grid-cols-2 xl:grid-cols-3">
                {SECURITY_SECTION.items.map((item) => (
                  <li key={item.title} className="border-b border-white/15 py-4 sm:pr-6">
                    <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                    <p className="mt-1.5 text-[0.82rem] leading-[1.6] text-white/72">{item.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
