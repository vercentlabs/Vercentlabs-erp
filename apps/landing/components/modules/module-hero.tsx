import type { LandingModule } from "@vercentlabs/landing-content";
import { cx } from "@/lib/utils";
import { Container, Section, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";

export function ModuleHero({ landingModule, className }: { landingModule: LandingModule; className?: string }) {
  const navGroupLabel =
    landingModule.navGroup === "revenue" ? "Revenue" :
    landingModule.navGroup === "operations" ? "Operations" :
    landingModule.navGroup === "finance" ? "Finance" :
    landingModule.navGroup === "delivery" ? "Delivery" : "People & Service";

  const operatingIndex = [
    { label: "Capability groups", value: String(landingModule.capabilityGroups.length).padStart(2, "0") },
    { label: "Workflow steps", value: String(landingModule.primaryWorkflow.steps.length).padStart(2, "0") },
    { label: "Connected modules", value: String(landingModule.connectedModules.length).padStart(2, "0") },
    { label: "Reporting views", value: String(landingModule.reporting.length).padStart(2, "0") },
  ];

  return (
    <Section tone="page" paddingTop={{ base: 10, sm: 14 }} paddingBottom={{ base: 12, sm: 18 }} className={cx("overflow-hidden", className)}>
      <Container>
        <div className="reveal-on-load border-t border-(--color-border-strong) pt-5">
          <div className="flex items-center justify-between gap-4">
            <Text variant="eyebrow">{navGroupLabel} module</Text>
            <span className="vl-folio">{landingModule.key.toUpperCase()} / MODULE</span>
          </div>

          <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,.65fr)] lg:items-end lg:gap-16">
            <div>
              <Heading level="display" as="h1" className="max-w-[10ch]">{landingModule.name}</Heading>
              <Text variant="lead" className="mt-6 max-w-[60ch]">{landingModule.bestAngle}</Text>
              <Inline gap={3} className="mt-7">
                <TrackedCtaLink href={`/book-demo?module=${landingModule.key}`} event="module_hero_cta_click" ctaLocation={`module_hero_${landingModule.key}`}>Book a Demo</TrackedCtaLink>
                <TrackedCtaLink href="/product/platform" event="platform_cta_click" ctaLocation={`module_hero_${landingModule.key}`} variant="secondary">Explore the Platform</TrackedCtaLink>
              </Inline>
            </div>

            <aside className="border-t border-(--color-border-strong) pt-4" aria-label={`${landingModule.name} operating index`}>
              <div className="mb-2 flex items-end justify-between gap-4">
                <span className="vl-index">Operating index</span>
                <span className="h-[3px] w-14" style={{ backgroundColor: landingModule.accentColor.hex }} aria-hidden="true" />
              </div>
              <dl>
                {operatingIndex.map((item, index) => (
                  <div key={item.label} className="grid grid-cols-[2rem_1fr_auto] items-end gap-3 border-b border-(--color-border-default) py-3.5">
                    <dt className="contents">
                      <span className="vl-index" style={{ color: landingModule.accentColor.hex }}>{String(index + 1).padStart(2, "0")}</span>
                      <span className="text-sm font-semibold text-(--color-text-primary)">{item.label}</span>
                    </dt>
                    <dd className="tabular-data text-2xl font-semibold leading-none tracking-[-0.05em] text-(--color-text-primary)">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>

          <div className="mt-12 border-y border-(--color-border-strong)">
            <div className="grid gap-0 md:grid-cols-[180px_1fr]">
              <div className="border-b border-(--color-border-default) py-5 md:border-b-0 md:border-r md:pr-6">
                <span className="vl-index">Primary sequence</span>
                <p className="mt-2 text-sm font-semibold text-(--color-text-primary)">{landingModule.primaryWorkflow.name}</p>
              </div>
              <ol className="grid sm:grid-cols-2 lg:grid-cols-4">
                {landingModule.primaryWorkflow.steps.slice(0, 4).map((step, index) => (
                  <li key={step.step} className="border-b border-(--color-border-default) px-0 py-5 sm:px-5 lg:border-b-0 lg:border-l">
                    <span className="vl-index" style={{ color: landingModule.accentColor.hex }}>{String(index + 1).padStart(2, "0")}</span>
                    <p className="mt-3 text-sm font-semibold leading-snug text-(--color-text-primary)">{step.step}</p>
                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-(--color-text-muted)">{step.detail}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <ModuleTag name={landingModule.name} accentColor={landingModule.accentColor.hex} />
            <span className="text-[0.64rem] font-bold uppercase tracking-[0.12em] text-(--color-text-muted)">Shared data model · structured controls · connected workflow</span>
          </div>
        </div>
      </Container>
    </Section>
  );
}
