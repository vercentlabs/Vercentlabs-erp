

import Link from "next/link";
import { getLandingModule, type PlatformPageContent } from "@vercentlabs/landing-content";
import { TrackView } from "@/components/analytics/track-view";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Container, Section, SectionHeader, SplitLayout, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import type { BreadcrumbEntry } from "@/lib/seo/json-ld";

const AUTOMATION_LOOP = [
  { label: "Trigger", value: "A business event occurs", color: "var(--color-module-crm)" },
  { label: "Evaluate", value: "Policy and thresholds run", color: "var(--color-module-sales)" },
  { label: "Govern", value: "Permissions and duties are checked", color: "var(--color-module-quality)" },
  { label: "Execute", value: "A state change or handoff completes", color: "var(--color-module-accounting)" },
] as const;

export function AutomationPageTemplate({
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
                  <span className="vl-folio">AUTOMATION CONTROL LOOP / RULE ENGINE</span>
                  <Text variant="eyebrow">{content.eyebrow}</Text>
                  <Heading level="display" as="h1">
                    {content.heading}
                  </Heading>
                  <Text variant="lead">{content.supportingText}</Text>
                  <div>
                    <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation="automation_hero">
                      {content.primaryCta.label}
                    </TrackedCtaLink>
                  </div>
                </Stack>
              }
              secondary={
                <div className="reveal-on-load reveal-on-load-delay-1 lg:pl-6">
                  <div className="flex items-end justify-between gap-4 border-b border-(--color-border-default) pb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">Control-loop register</p>
                      <p className="mt-1 text-sm text-(--color-text-secondary)">Trigger → evaluate → govern → execute.</p>
                    </div>
                    <span className="tabular-data text-3xl font-semibold tracking-[-0.04em] text-(--color-text-primary)">04</span>
                  </div>
                  <ol className="relative mt-6 border-l-2 border-(--color-border-brand)">
                  {AUTOMATION_LOOP.map((stage, index) => (
                    <li key={stage.label} className="relative py-3 pl-9 first:pt-0 last:pb-0">
                      <span className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-[3px] text-[0.68rem] font-semibold text-(--color-text-inverse) ${index === 0 ? "top-0" : "top-3"}`} style={{ backgroundColor: stage.color }} aria-hidden="true">
                          {index + 1}
                      </span>
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="text-sm font-semibold text-(--color-text-primary)">{stage.label}</p>
                        {index < AUTOMATION_LOOP.length - 1 ? (
                          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-(--color-text-brand)" aria-hidden="true">
                            <path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-(--color-state-success)" aria-hidden="true" />
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-(--color-text-secondary)">{stage.value}</p>
                    </li>
                  ))}
                  </ol>
                  <div className="mt-7 border-t border-(--color-border-default) pt-5">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-(--color-text-muted)">Running across</p>
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
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">What the automation engine is</p>
              <p className="text-base font-medium leading-relaxed text-(--color-text-primary)">{content.directDefinition}</p>
            </div>
          </Container>
        </Section>
      </TrackView>

      <Section tone="page">
        <Container>
          <SectionHeader
            eyebrow="Rules you can inspect"
            title="Automation with a trigger, a guard, and an accountable outcome."
            description="Each example below is already evidenced in the product. The system makes the decision path explicit instead of hiding it inside an ad hoc script."
          />

          <div className="mt-10 border-y border-(--color-border-strong) bg-(--color-bg-elevated)">
            {content.sections.map((section, sectionIndex) => (
              <section key={section.id} id={section.id} className="border-t border-(--color-border-default) first:border-t-0">
                <div className="flex flex-col gap-3 bg-(--color-bg-subtle) px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
                  <div className="flex items-center gap-4">
                    <span className="tabular-data text-xs font-semibold tracking-[0.08em] text-(--color-text-brand)">{String(sectionIndex + 1).padStart(2, "0")}</span>
                    <h2 className="text-lg font-semibold tracking-[-0.025em] text-(--color-text-primary)">{section.heading}</h2>
                  </div>
                  <span className="text-xs font-medium uppercase tracking-[0.08em] text-(--color-text-muted)">{section.items.length} implemented rule{section.items.length === 1 ? "" : "s"}</span>
                </div>

                <div className={`grid grid-cols-1 gap-px bg-(--color-border-default) ${section.items.length > 2 ? "lg:grid-cols-3" : "sm:grid-cols-2"}`}>
                  {section.items.map((item, itemIndex) => (
                    <div key={item.title} className="bg-(--color-bg-elevated) p-5 sm:p-6">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-(--color-bg-subtle) text-(--color-text-brand)" aria-hidden="true">
                          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                            <path d="M10 2.8v2.1m0 10.2v2.1M2.8 10h2.1m10.2 0h2.1M4.9 4.9l1.5 1.5m7.2 7.2 1.5 1.5m0-10.2-1.5 1.5m-7.2 7.2-1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                            <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        </span>
                        <span className="tabular-data text-xs font-semibold text-(--color-text-muted)">{String(itemIndex + 1).padStart(2, "0")}</span>
                      </div>
                      <h3 className="mt-6 text-sm font-semibold text-(--color-text-primary)">{item.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{item.description}</p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Container>
      </Section>

      <Section tone="elevated" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 8, sm: 10 }}>
        <Container>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-(--color-text-brand)">Bring one of your workflows</p>
              <p className="mt-1 text-base font-medium text-(--color-text-primary)">See where Vercentlabs can automate it—and where a human approval should remain.</p>
            </div>
            <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation="automation_mid" variant="secondary">
              {content.primaryCta.label}
            </TrackedCtaLink>
          </div>
        </Container>
      </Section>

      {connectedModules.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="Cross-module by design" title="Rules that follow the work, not the application boundary." description="Automation uses the same governed primitives while each module contributes its own business events and state transitions." />
            <div className="mt-10 grid grid-cols-1 gap-px border-l border-t border-(--color-border-strong) bg-(--color-border-default) sm:grid-cols-2 lg:grid-cols-5">
              {connectedModules.map((module, index) => (
                <Link key={module.key} href={`/modules/${module.key}`} prefetch={false} className="group bg-(--color-bg-elevated) p-5 transition-colors hover:bg-(--color-bg-subtle)">
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
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">Governed from trigger to outcome</p>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">
                {content.finalCtaHeading}
              </Heading>
            </div>
            <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation="automation_final">
              {content.primaryCta.label}
            </TrackedCtaLink>
          </div>
        </Container>
      </Section>
    </>
  );
}
