

import Link from "next/link";
import { getLandingModule, type PlatformPageContent } from "@vercentlabs/landing-content";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Container, Section, SectionHeader, SplitLayout, Stack } from "@/components/layout/container";
import { TrackView } from "@/components/analytics/track-view";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { ModuleTag } from "@/components/ui/tag";
import { Heading, Text } from "@/components/ui/text";
import type { BreadcrumbEntry } from "@/lib/seo/json-ld";

export function PlatformArchitectureTemplate({
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
                  <span className="vl-folio">PLATFORM BLUEPRINT / CONTROL PLANE</span>
                  <Text variant="eyebrow">{content.eyebrow}</Text>
                  <Heading level="display" as="h1">
                    {content.heading}
                  </Heading>
                  <Text variant="lead">{content.supportingText}</Text>
                  <div>
                    <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation="platform_architecture_hero">
                      {content.primaryCta.label}
                    </TrackedCtaLink>
                  </div>
                </Stack>
              }
              secondary={
                <div className="reveal-on-load reveal-on-load-delay-1 lg:pl-6">
                  <div className="flex items-end justify-between gap-4 border-b border-(--color-border-default) pb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">Blueprint register</p>
                      <p className="mt-1 text-sm text-(--color-text-secondary)">Five control layers inherited by every operating module.</p>
                    </div>
                    <span className="tabular-data text-3xl font-semibold tracking-[-0.04em] text-(--color-text-primary)">05</span>
                  </div>
                  <ol className="relative mt-6 border-l-2 border-(--color-border-brand)">
                  {content.sections.map((section, index) => (
                    <li key={section.id} className="relative py-3 pl-7 first:pt-0 last:pb-0">
                      <span className={`absolute -left-[7px] h-3 w-3 rounded-full border-2 border-(--color-border-brand) bg-(--color-bg-page) ${index === 0 ? "top-1" : "top-[1.15rem]"}`} aria-hidden="true" />
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="text-sm font-semibold text-(--color-text-primary)">{section.heading}</p>
                        <span className="tabular-data text-xs text-(--color-text-muted)">{String(index + 1).padStart(2, "0")}</span>
                      </div>
                      <p className="mt-1 text-xs text-(--color-text-secondary)">{section.items.length} shared control{section.items.length === 1 ? "" : "s"}</p>
                    </li>
                  ))}
                  </ol>
                  <div className="mt-7 border-t border-(--color-border-default) pt-5">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-(--color-text-muted)">Inherited across</p>
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
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">What the platform is</p>
              <p className="text-base font-medium leading-relaxed text-(--color-text-primary)">{content.directDefinition}</p>
            </div>
          </Container>
        </Section>
      </TrackView>

      <Section tone="page">
        <Container>
          <SectionHeader
            eyebrow="Platform blueprint"
            title="One control plane beneath every module."
            description="The platform centralises isolation, access, approvals, audit, and onboarding so operational modules do not have to recreate those controls independently."
          />

          <div className="mt-10 border-y border-(--color-border-strong) bg-(--color-bg-elevated)">
            {content.sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                className="grid grid-cols-1 gap-5 border-t border-(--color-border-default) px-5 py-7 first:border-t-0 sm:px-6 lg:grid-cols-[64px_340px_minmax(0,1fr)] lg:gap-8 lg:px-8"
              >
                <span className="tabular-data text-xs font-semibold tracking-[0.08em] text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.03em] text-(--color-text-primary)">{section.heading}</h2>
                  {section.supportingText ? <p className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{section.supportingText}</p> : null}
                </div>
                <div
                  className={`grid grid-cols-1 gap-px border-l border-t border-(--color-border-default) bg-(--color-border-default) lg:self-start ${section.items.length > 1 ? "sm:grid-cols-2" : ""}`}
                >
                  {section.items.map((item) => (
                    <div key={item.title} className="bg-(--color-bg-subtle) p-4">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-(--color-state-success-soft) text-(--color-state-success)" aria-hidden="true">
                          <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
                            <path d="m5 10 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-(--color-text-primary)">{item.title}</p>
                          <p className="mt-1 text-sm leading-relaxed text-(--color-text-secondary)">{item.description}</p>
                        </div>
                      </div>
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
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-(--color-text-brand)">See the controls in context</p>
              <p className="mt-1 text-base font-medium text-(--color-text-primary)">Follow a real transaction across modules, permissions, approvals, and audit history.</p>
            </div>
            <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation="platform_architecture_mid" variant="secondary">
              {content.primaryCta.label}
            </TrackedCtaLink>
          </div>
        </Container>
      </Section>

      {connectedModules.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="Inherited by design" title="The same controls, wherever work happens." description="These modules expose different workflows, but they inherit the same identity, access, approval, and audit foundations." />
            <div className="mt-10 grid grid-cols-1 gap-px border-l border-t border-(--color-border-strong) bg-(--color-border-default) sm:grid-cols-2 lg:grid-cols-4">
              {connectedModules.map((module, index) => (
                <Link key={module.key} href={`/modules/${module.key}`} prefetch={false} className="group bg-(--color-bg-elevated) p-5 transition-colors hover:bg-(--color-bg-subtle) sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <ModuleTag name={module.name} accentColor={module.accentColor.hex} />
                    <span className="tabular-data text-xs font-semibold text-(--color-text-muted)">{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <p className="mt-8 text-sm leading-relaxed text-(--color-text-secondary)">Built on the shared platform control plane.</p>
                  <span className="mt-6 block text-sm font-medium text-(--color-text-brand) group-hover:underline">Explore {module.name} →</span>
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
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">One platform, every workflow</p>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">
                {content.finalCtaHeading}
              </Heading>
            </div>
            <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation="platform_architecture_final">
              {content.primaryCta.label}
            </TrackedCtaLink>
          </div>
        </Container>
      </Section>
    </>
  );
}
