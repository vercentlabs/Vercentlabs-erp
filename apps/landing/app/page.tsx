import Link from "next/link";
import {
  HOMEPAGE_METADATA,
  HERO,
  PROBLEM_SECTION,
  CONNECTED_SYSTEM_SECTION,
  MODULE_ARCHITECTURE_SECTION,
  BREADTH_SECTION,
  FLAGSHIP_WORKFLOW_SECTION,
  ROLE_VALUE_SECTION,
  AUTOMATION_SECTION,
  SECURITY_SECTION,
  IMPLEMENTATION_SECTION,
  BUYER_QUESTIONS_SECTION,
  FINAL_CTA_SECTION,
  MODULE_NAV_GROUPS,
  LANDING_MODULES,
  CTAS,
} from "@vercentlabs/landing-content";
import { Container, Section, Stack, Inline, SplitLayout, SectionHeader } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ButtonLink } from "@/components/ui/button";
import { ModuleTag } from "@/components/ui/tag";
import { ProductScreenshot, WorkflowConnector } from "@/components/product/product-frame";
import { getApprovedScreenshot } from "@/lib/product/screenshots";
import { FlagshipWorkflow } from "@/components/workflows/flagship-workflow";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackView } from "@/components/analytics/track-view";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { HomepageViewTracker } from "@/components/analytics/homepage-view-tracker";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";

export const metadata = buildPageMetadata({
  title: HOMEPAGE_METADATA.title,
  description: HOMEPAGE_METADATA.description,
  path: "/",
});

const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": SOFTWARE_APPLICATION_ID,
  name: "Vercentlabs ERP",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: HOMEPAGE_METADATA.description,
};

const faqPageJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: BUYER_QUESTIONS_SECTION.questions.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

export default function HomePage() {
  const hasHeroScreenshot = Boolean(getApprovedScreenshot(HERO.screenshotId));

  const heroCopy = (
    <Stack gap={5} className={hasHeroScreenshot ? "reveal-on-load" : "reveal-on-load max-w-[720px]"}>
      <Text variant="eyebrow">{HERO.eyebrow}</Text>
      <Heading level="display">{HERO.heading}</Heading>
      <Text variant="lead">{HERO.supportingText}</Text>
      <Inline gap={3}>
        <TrackedCtaLink href={HERO.primaryCta.href} event={HERO.primaryCta.analyticsId} ctaLocation="hero">
          {HERO.primaryCta.label}
        </TrackedCtaLink>
        <TrackedCtaLink href={HERO.secondaryCta.href} event={HERO.secondaryCta.analyticsId} ctaLocation="hero" variant="secondary">
          {HERO.secondaryCta.label}
        </TrackedCtaLink>
      </Inline>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-border-default) sm:grid-cols-4">
        {HERO.evidence.map((item) => (
          <div key={item.label} className="bg-(--color-bg-elevated) px-4 py-4">
            <p className="tabular-data text-lg font-semibold tracking-[-0.02em] text-(--color-text-primary)">{item.value}</p>
            <p className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-(--color-text-muted)">{item.label}</p>
          </div>
        ))}
      </div>
    </Stack>
  );

  return (
    <>
      <HomepageViewTracker />
      {/* Hero */}
      <TrackView event="hero_view">
        {/* Header is a sticky h-16 (4rem) bar — this fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <Section tone="page" paddingTop={{ base: 12, sm: 16 }} className="flex min-h-[calc(100vh-4rem)] flex-col justify-center">
          <Container>
            {hasHeroScreenshot ? (
              <SplitLayout
                ratio="primary-wide"
                primary={heroCopy}
                secondary={
                  <div className="reveal-on-load reveal-on-load-delay-1">
                    <ProductScreenshot id={HERO.screenshotId} moduleAccentColor="var(--color-brand)" priority />
                  </div>
                }
              />
            ) : (
              heroCopy
            )}
          </Container>
        </Section>
      </TrackView>

      {/* Problem framing */}
      <TrackView event="problem_section_view">
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={PROBLEM_SECTION.eyebrow} title={PROBLEM_SECTION.heading} description={PROBLEM_SECTION.supportingText} />
            <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-border-default) sm:grid-cols-2 xl:grid-cols-4">
              {PROBLEM_SECTION.items.map((item, index) => (
                <div key={item.title} className="bg-(--color-bg-elevated) p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <span className="tabular-data text-xs font-semibold tracking-[0.08em] text-(--color-text-muted)">{String(index + 1).padStart(2, "0")}</span>
                    <span className="h-2 w-2 rounded-full bg-(--color-state-warning)" aria-hidden="true" />
                  </div>
                  <p className="mt-7 text-sm font-semibold text-(--color-text-primary)">{item.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{item.description}</p>
                </div>
              ))}
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* Connected system explanation */}
      <TrackView event="workflow_view" properties={{ section: "connected-system" }}>
        <Section tone="subtle">
          <Container>
            <SectionHeader
              eyebrow={CONNECTED_SYSTEM_SECTION.eyebrow}
              title={CONNECTED_SYSTEM_SECTION.heading}
              description={CONNECTED_SYSTEM_SECTION.supportingText}
            />
            <div className="mt-10 overflow-hidden rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-border-default) shadow-(--shadow-subtle)">
              <div className="bg-(--color-bg-elevated) px-5 py-6 sm:px-6 lg:px-8">
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Connected system workflow steps">
                  <WorkflowConnector
                    reveal={false}
                    className="min-w-[760px] lg:min-w-0"
                    steps={CONNECTED_SYSTEM_SECTION.steps.map((step) => {
                      const moduleInfo = LANDING_MODULES.find((candidate) => candidate.key === step.module);
                      return { label: step.label, accentColor: moduleInfo?.accentColor.hex ?? "var(--color-brand)" };
                    })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-px bg-(--color-border-default) sm:grid-cols-2 lg:grid-cols-4">
                {CONNECTED_SYSTEM_SECTION.steps.map((step, index) => {
                  const moduleInfo = LANDING_MODULES.find((candidate) => candidate.key === step.module);
                  return (
                    <div key={step.label} className="bg-(--color-bg-elevated) p-5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="tabular-data text-xs font-semibold text-(--color-text-muted)">{String(index + 1).padStart(2, "0")}</span>
                        {moduleInfo ? <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} /> : null}
                      </div>
                      <p className="mt-5 text-sm font-semibold text-(--color-text-primary)">{step.label}</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-(--color-text-secondary)">{step.detail}</p>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end bg-(--color-bg-elevated) px-5 py-4 sm:px-6 lg:px-8">
                <ButtonLink href="/product/platform" variant="tertiary" prefetch={false}>
                  See how the platform connects →
                </ButtonLink>
              </div>
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* Module architecture */}
      <TrackView event="module_group_view">
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={MODULE_ARCHITECTURE_SECTION.eyebrow} title={MODULE_ARCHITECTURE_SECTION.heading} description={MODULE_ARCHITECTURE_SECTION.supportingText} />
            <div className="mt-10 overflow-hidden rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-bg-elevated) shadow-(--shadow-subtle)">
              {MODULE_NAV_GROUPS.map((group, index) => {
                const summary = MODULE_ARCHITECTURE_SECTION.groupSummaries.find((item) => item.groupKey === group.key);
                return (
                  <div
                    key={group.key}
                    className="grid grid-cols-1 gap-5 border-t border-(--color-border-default) px-5 py-6 first:border-t-0 sm:px-6 lg:grid-cols-[56px_360px_1fr] lg:items-center lg:px-8"
                  >
                    <span className="tabular-data text-xs font-semibold tracking-[0.08em] text-(--color-text-muted)">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <p className="text-sm font-semibold text-(--color-text-primary)">{group.label}</p>
                      {summary ? (
                        <p className="mt-1 text-sm leading-relaxed text-(--color-text-secondary)">{summary.outcome}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {group.moduleKeys.map((key) => {
                        const moduleInfo = LANDING_MODULES.find((candidate) => candidate.key === key);
                        if (!moduleInfo) return null;
                        return (
                          <Link key={key} href={`/modules/${key}`} prefetch={false}>
                            <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-end border-t border-(--color-border-default) bg-(--color-bg-subtle) px-5 py-4 sm:px-6 lg:px-8">
                <ButtonLink href="/modules" variant="tertiary" prefetch={false}>
                  See all modules →
                </ButtonLink>
              </div>
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* Product breadth and depth */}
      <TrackView event="breadth_section_view">
        <Section tone="inverse">
          <Container>
            <SectionHeader
              eyebrow={BREADTH_SECTION.eyebrow}
              title={BREADTH_SECTION.heading}
              description={BREADTH_SECTION.supportingText}
              className="[&_h2]:text-(--color-text-inverse) [&_p]:text-white/70"
            />
            <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-(--radius-panel) border border-white/15 bg-white/15 sm:grid-cols-2 lg:grid-cols-4">
              {BREADTH_SECTION.breakdown.map((item, index) => (
                <div key={item.label} className="bg-(--color-bg-inverse) p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <p className="tabular-data text-3xl font-semibold tracking-[-0.03em] text-(--color-text-inverse)">{item.value}</p>
                    <span className="tabular-data text-xs font-semibold text-white/60">0{index + 1}</span>
                  </div>
                  <p className="mt-6 text-sm font-semibold text-white/85">{item.label}</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">{item.description}</p>
                </div>
              ))}
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* Flagship workflow */}
      <TrackView event="workflow_interaction" properties={{ workflow: FLAGSHIP_WORKFLOW_SECTION.workflowSlug }}>
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={FLAGSHIP_WORKFLOW_SECTION.eyebrow} title={FLAGSHIP_WORKFLOW_SECTION.heading} description={FLAGSHIP_WORKFLOW_SECTION.supportingText} />
            <FlagshipWorkflow steps={FLAGSHIP_WORKFLOW_SECTION.steps} workflowSlug={FLAGSHIP_WORKFLOW_SECTION.workflowSlug} />
          </Container>
        </Section>
      </TrackView>

      {/* Role-based value */}
      <TrackView event="role_value_view">
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow={ROLE_VALUE_SECTION.eyebrow} title={ROLE_VALUE_SECTION.heading} />
            <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-border-default) sm:grid-cols-2 lg:grid-cols-3">
              {ROLE_VALUE_SECTION.roles.map((item, index) => (
                <div key={item.role} className="bg-(--color-bg-elevated) p-5 sm:p-6">
                  <span className="tabular-data text-xs font-semibold tracking-[0.08em] text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                  <p className="mt-6 text-sm font-semibold text-(--color-text-primary)">{item.role}</p>
                  <p className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{item.gains}</p>
                </div>
              ))}
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* Automation and analytics */}
      <TrackView event="automation_section_view">
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={AUTOMATION_SECTION.eyebrow} title={AUTOMATION_SECTION.heading} />
            <div className="mt-10 overflow-hidden rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-bg-elevated) shadow-(--shadow-subtle)">
              {AUTOMATION_SECTION.items.map((item) => (
                <div key={item.title} className="grid grid-cols-[40px_1fr] gap-4 border-t border-(--color-border-default) px-5 py-5 first:border-t-0 sm:grid-cols-[56px_220px_1fr] sm:items-start sm:px-6 lg:grid-cols-[72px_280px_1fr] lg:px-8">
                  <span className="flex h-8 w-8 items-center justify-center rounded-(--radius-control) bg-(--color-bg-subtle) text-(--color-text-brand)" aria-hidden="true">
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                      <path d="M5 10.5 8.5 14 15 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <p className="text-sm font-semibold text-(--color-text-primary)">{item.title}</p>
                  <p className="col-start-2 text-sm leading-relaxed text-(--color-text-secondary) sm:col-start-3">{item.description}</p>
                </div>
              ))}
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* Security and governance */}
      <TrackView event="security_section_view">
        <Section tone="elevated">
          <Container>
            <SectionHeader eyebrow={SECURITY_SECTION.eyebrow} title={SECURITY_SECTION.heading} description={SECURITY_SECTION.supportingText} />
            <div className="mt-10 overflow-hidden rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-border-default) shadow-(--shadow-subtle)">
              <div className="grid grid-cols-1 gap-px bg-(--color-border-default) sm:grid-cols-2 lg:grid-cols-3">
                {SECURITY_SECTION.items.map((item, index) => (
                  <div key={item.title} className="bg-(--color-bg-elevated) p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-(--radius-control) bg-(--color-state-success-soft) text-(--color-state-success)" aria-hidden="true">
                        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                          <path d="M10 3.5 15 5.4v3.8c0 3.1-1.9 5.9-5 7.3-3.1-1.4-5-4.2-5-7.3V5.4L10 3.5Z" stroke="currentColor" strokeWidth="1.5" />
                          <path d="m7.5 10 1.6 1.6 3.4-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="tabular-data text-xs font-semibold text-(--color-text-muted)">{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <p className="mt-6 text-sm font-semibold text-(--color-text-primary)">{item.title}</p>
                    <p className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{item.description}</p>
                  </div>
                ))}
              </div>
              <div className="flex justify-end bg-(--color-bg-subtle) px-5 py-4 sm:px-6 lg:px-8">
                <ButtonLink href="/security" variant="tertiary" prefetch={false}>
                  See the security architecture →
                </ButtonLink>
              </div>
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* Implementation */}
      <TrackView event="implementation_section_view">
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={IMPLEMENTATION_SECTION.eyebrow} title={IMPLEMENTATION_SECTION.heading} description={IMPLEMENTATION_SECTION.supportingText} />
            <div className="mt-10 grid grid-cols-1 overflow-hidden rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-bg-elevated) shadow-(--shadow-subtle) lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
              <div className="flex flex-col justify-between bg-(--color-bg-subtle) p-6 sm:p-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">Rollout model</p>
                  <h3 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-(--color-text-primary)">Seven controlled phases from discovery to support.</h3>
                  <p className="mt-4 text-sm leading-relaxed text-(--color-text-secondary)">Configure around real processes, validate with real transactions, then launch in controlled stages.</p>
                </div>
                <div className="mt-8">
                  <TrackedCtaLink href={CTAS.talkToSpecialist.href} event="implementation_specialist_cta_click" ctaLocation="implementation" variant="secondary">
                    {CTAS.talkToSpecialist.label}
                  </TrackedCtaLink>
                </div>
              </div>
              <ol className="border-t border-(--color-border-default) lg:border-l lg:border-t-0">
                {IMPLEMENTATION_SECTION.steps.map((item) => (
                  <li key={item.step} className="grid grid-cols-[44px_1fr] gap-4 border-t border-(--color-border-default) px-5 py-5 first:border-t-0 sm:grid-cols-[56px_180px_1fr] sm:px-6 lg:px-8">
                    <span className="tabular-data text-xs font-semibold text-(--color-text-brand)">{item.step}</span>
                    <p className="text-sm font-semibold text-(--color-text-primary)">{item.title}</p>
                    <p className="col-start-2 text-sm leading-relaxed text-(--color-text-secondary) sm:col-start-3">{item.description}</p>
                  </li>
                ))}
              </ol>
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* Buyer questions */}
      <TrackView event="buyer_questions_view">
        <Section tone="subtle">
          <Container>
            <div className="grid grid-cols-1 gap-10 rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-bg-elevated) p-6 shadow-(--shadow-subtle) sm:p-8 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)] lg:gap-16">
              <SectionHeader eyebrow={BUYER_QUESTIONS_SECTION.eyebrow} title={BUYER_QUESTIONS_SECTION.heading} />
              <FaqAccordion items={BUYER_QUESTIONS_SECTION.questions} reveal={false} />
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* Final CTA */}
      <TrackView event="final_cta_view">
        <Section tone="inverse">
          <Container>
            <div className="grid grid-cols-1 items-center gap-8 rounded-(--radius-panel) border border-white/15 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:p-10">
              <div className="max-w-[760px]">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/55">Built around your workflow</p>
                <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">
                  {FINAL_CTA_SECTION.heading}
                </Heading>
                <Text variant="lead" className="mt-3 text-white/70">
                  {FINAL_CTA_SECTION.supportingText}
                </Text>
              </div>
              <div className="flex lg:justify-end">
                <TrackedCtaLink href={FINAL_CTA_SECTION.primaryCta.href} event={FINAL_CTA_SECTION.primaryCta.analyticsId} ctaLocation="final_cta">
                  {FINAL_CTA_SECTION.primaryCta.label}
                </TrackedCtaLink>
              </div>
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* The sticky mobile CTA bar (and its footer-clearance spacer) is now
          mounted once, globally, in app/layout.tsx — see
          docs/landing-redesign/phase-4/decision-log.md for why. */}

      {/* Organization/WebSite JSON-LD is rendered once, site-wide, by app/layout.tsx. */}
      <script {...jsonLdScriptProps(softwareApplicationJsonLd)} />
      <script {...jsonLdScriptProps(faqPageJsonLd)} />
    </>
  );
}
