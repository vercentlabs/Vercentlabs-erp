

import Link from "next/link";
import { getLandingModule, type PlatformPageContent } from "@vercentlabs/landing-content";
import { TrackView } from "@/components/analytics/track-view";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Container, Section, SectionHeader, SplitLayout, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import type { BreadcrumbEntry } from "@/lib/seo/json-ld";

const REPORT_REGISTRIES = [
  { name: "CRM", count: 14, width: "87.5%", color: "var(--color-module-crm)" },
  { name: "Accounting", count: 16, width: "100%", color: "var(--color-module-accounting)" },
  { name: "Procurement", count: 12, width: "75%", color: "var(--color-module-procurement)" },
] as const;

export function AnalyticsPageTemplate({
  content,
  breadcrumbTrail,
}: {
  content: PlatformPageContent;
  breadcrumbTrail: BreadcrumbEntry[];
}) {
  const connectedModules = content.connectedModuleKeys
    .map((key) => getLandingModule(key))
    .filter((module): module is NonNullable<typeof module> => Boolean(module));

  return (
    <>
      <TrackView event="platform_page_view" properties={{ workflow: content.slug }}>
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container>
            <Breadcrumbs trail={breadcrumbTrail} />
          </Container>
        </Section>

        <Section tone="page" paddingTop={{ base: 10, sm: 12 }} paddingBottom={{ base: 16, sm: 20 }}>
          <Container>
            <SplitLayout
              ratio="primary-wide"
              primary={
                <Stack gap={5} className="reveal-on-load">
                  <span className="vl-folio">SIGNAL BOARD / REPORTING REGISTRY</span>
                  <Text variant="eyebrow">{content.eyebrow}</Text>
                  <Heading level="display" as="h1">
                    {content.heading}
                  </Heading>
                  <Text variant="lead">{content.supportingText}</Text>
                  <div>
                    <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation="analytics_hero">
                      {content.primaryCta.label}
                    </TrackedCtaLink>
                  </div>
                </Stack>
              }
              secondary={
                <div className="reveal-on-load reveal-on-load-delay-1 lg:pl-6">
                  <div className="flex items-end justify-between gap-4 border-b border-(--color-border-default) pb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">Signal registry</p>
                      <p className="mt-1 text-sm text-(--color-text-secondary)">Operational records translated into decision-ready views.</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular-data text-3xl font-semibold tracking-[-0.04em] text-(--color-text-primary)">42</p>
                      <p className="text-xs text-(--color-text-muted)">report types</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-5">
                    {REPORT_REGISTRIES.map((registry) => (
                      <div key={registry.name}>
                        <div className="flex items-baseline justify-between gap-4">
                          <p className="text-sm font-semibold text-(--color-text-primary)">{registry.name}</p>
                          <p className="tabular-data text-xs text-(--color-text-muted)">{registry.count} reports</p>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--color-border-default)" aria-hidden="true">
                          <div className="h-full rounded-full" style={{ width: registry.width, backgroundColor: registry.color }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-7 border-t border-(--color-border-default) pt-5">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-(--color-text-muted)">Reporting across</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {connectedModules.map((module) => (
                        <Link key={module.key} href={`/modules/${module.key}`} prefetch={false}>
                          <ModuleTag name={module.name} accentColor={module.accentColor.hex} />
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              }
            />

            <div className="mt-12 grid grid-cols-1 gap-4 border-t border-(--color-border-default) pt-8 lg:grid-cols-[220px_minmax(0,820px)] lg:gap-12">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">What analytics means here</p>
              <p className="text-base font-medium leading-relaxed text-(--color-text-primary)">{content.directDefinition}</p>
            </div>
          </Container>
        </Section>
      </TrackView>

      <Section tone="subtle">
        <Container>
          <div className="border-y border-(--color-border-strong) bg-(--color-bg-elevated)">
            <div className="grid grid-cols-1 gap-px bg-(--color-border-default) sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["01", "Operational data", "The same records teams update every day."],
                ["02", "Role scope", "Company, branch, and permission boundaries apply."],
                ["03", "Live report", "Dashboards reflect the current operational state."],
                ["04", "Governed output", "Exports and documents pass shared safeguards."],
              ].map(([number, label, description]) => (
                <div key={number} className="bg-(--color-bg-elevated) p-5 sm:p-6">
                  <span className="tabular-data text-xs font-semibold text-(--color-text-brand)">{number}</span>
                  <p className="mt-6 text-sm font-semibold text-(--color-text-primary)">{label}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-(--color-text-secondary)">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="page">
        <Container>
          <SectionHeader
            eyebrow="One reporting layer"
            title="From operational record to decision-ready output."
            description="Dashboards, report registries, cross-module visibility, and governed exports all read from the same live system."
          />

          <div className="mt-10 border-y border-(--color-border-strong) bg-(--color-bg-elevated)">
            {content.sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                className="grid grid-cols-1 gap-5 border-t border-(--color-border-default) px-5 py-7 first:border-t-0 sm:px-6 lg:grid-cols-[64px_320px_minmax(0,1fr)] lg:gap-8 lg:px-8"
              >
                <span className="tabular-data text-xs font-semibold tracking-[0.08em] text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.03em] text-(--color-text-primary)">{section.heading}</h2>
                  {section.supportingText && section.items.length > 0 ? <p className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{section.supportingText}</p> : null}
                </div>

                {section.items.length > 0 ? (
                  <div className={`grid grid-cols-1 gap-px border-l border-t border-(--color-border-default) bg-(--color-border-default) lg:self-start ${section.items.length > 2 ? "xl:grid-cols-3" : "sm:grid-cols-2"}`}>
                    {section.items.map((item) => (
                      <div key={item.title} className="bg-(--color-bg-subtle) p-4">
                        <div className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-(--color-bg-elevated) text-(--color-text-brand)" aria-hidden="true">
                          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                            <path d="M4 15V9m4 6V5m4 10v-4m4 4V3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </div>
                        <h3 className="mt-4 text-sm font-semibold text-(--color-text-primary)">{item.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-(--color-text-secondary)">{item.description}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border-l-2 border-(--color-border-brand) pl-5 lg:self-center">
                    <p className="text-sm font-medium leading-relaxed text-(--color-text-primary)">{section.supportingText}</p>
                  </div>
                )}
              </section>
            ))}
          </div>
        </Container>
      </Section>

      <Section tone="elevated" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 8, sm: 10 }}>
        <Container>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-(--color-text-brand)">Use your reporting questions</p>
              <p className="mt-1 text-base font-medium text-(--color-text-primary)">See which answers are available live, by role, without waiting for a separate reporting refresh.</p>
            </div>
            <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation="analytics_mid" variant="secondary">
              {content.primaryCta.label}
            </TrackedCtaLink>
          </div>
        </Container>
      </Section>

      {connectedModules.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="Module depth, shared data" title="Purpose-built reports without separate reporting silos." description="Each module contributes domain-specific views while access and export controls remain consistent across the platform." />
            <div className="mt-10 grid grid-cols-1 gap-px border-l border-t border-(--color-border-strong) bg-(--color-border-default) sm:grid-cols-3">
              {connectedModules.map((module, index) => (
                <Link key={module.key} href={`/modules/${module.key}`} prefetch={false} className="group bg-(--color-bg-elevated) p-5 transition-colors hover:bg-(--color-bg-subtle) sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <ModuleTag name={module.name} accentColor={module.accentColor.hex} />
                    <span className="tabular-data text-xs font-semibold text-(--color-text-muted)">{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <span className="mt-8 block text-sm font-medium text-(--color-text-brand) group-hover:underline">Explore {module.name} →</span>
                </Link>
              ))}
            </div>
          </Container>
        </Section>
      ) : null}

      <Section tone="inverse">
        <Container>
          <div className="grid grid-cols-1 items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[760px]">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">Live data, scoped answers</p>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">
                {content.finalCtaHeading}
              </Heading>
            </div>
            <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation="analytics_final">
              {content.primaryCta.label}
            </TrackedCtaLink>
          </div>
        </Container>
      </Section>
    </>
  );
}
