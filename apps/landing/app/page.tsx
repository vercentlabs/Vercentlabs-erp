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
import { Container, Section, Stack, Inline, Grid, SectionHeader } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ButtonLink } from "@/components/ui/button";
import { ModuleTag } from "@/components/ui/tag";
import { Metric, FeatureList, InformationBand } from "@/components/ui/card";
import { ProductScreenshot, WorkflowConnector } from "@/components/product/product-frame";
import { getApprovedScreenshot } from "@/lib/product/screenshots";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { NumberedSteps } from "@/components/marketing/numbered-steps";
import { StickyMobileCta } from "@/components/marketing/sticky-mobile-cta";
import { TrackView } from "@/components/analytics/track-view";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { HomepageViewTracker } from "@/components/analytics/homepage-view-tracker";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";

export const metadata = buildPageMetadata({
  title: HOMEPAGE_METADATA.title,
  description: HOMEPAGE_METADATA.description,
  path: "/",
});

const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
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
  const approvedWorkflowScreenshotIds = FLAGSHIP_WORKFLOW_SECTION.screenshotIds.filter((id) => getApprovedScreenshot(id));

  return (
    <>
      <HomepageViewTracker />
      {/* Hero */}
      <TrackView event="hero_view">
        <Section tone="page" className="pt-12 sm:pt-16">
          <Container>
            <Grid
              columns={hasHeroScreenshot ? 2 : 1}
              gap={8}
              className={hasHeroScreenshot ? "items-center lg:grid-cols-[1.1fr_1fr]" : "items-start"}
            >
              <Stack gap={5} className={hasHeroScreenshot ? undefined : "max-w-[720px]"}>
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
                <Inline gap={6} className="mt-2 flex-wrap">
                  {HERO.evidence.map((item) => (
                    <Metric key={item.label} label={item.label} value={item.value} />
                  ))}
                </Inline>
              </Stack>
              {hasHeroScreenshot ? <ProductScreenshot id={HERO.screenshotId} moduleAccentColor="var(--color-brand)" /> : null}
            </Grid>
          </Container>
        </Section>
      </TrackView>

      {/* Problem framing */}
      <TrackView event="problem_section_view">
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={PROBLEM_SECTION.eyebrow} title={PROBLEM_SECTION.heading} description={PROBLEM_SECTION.supportingText} />
            <Grid columns={4} gap={6} className="mt-10">
              {PROBLEM_SECTION.items.map((item) => (
                <div key={item.title}>
                  <Text variant="label">{item.title}</Text>
                  <Text variant="bodySmall" className="mt-1.5">
                    {item.description}
                  </Text>
                </div>
              ))}
            </Grid>
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
            <div className="mt-10 overflow-x-auto">
              <WorkflowConnector
                className="min-w-[760px] lg:min-w-0"
                steps={CONNECTED_SYSTEM_SECTION.steps.map((step) => {
                  const moduleInfo = LANDING_MODULES.find((candidate) => candidate.key === step.module);
                  return { label: step.label, accentColor: moduleInfo?.accentColor.hex ?? "var(--color-brand)" };
                })}
              />
            </div>
            <Grid columns={4} gap={4} className="mt-8">
              {CONNECTED_SYSTEM_SECTION.steps.map((step) => (
                <Text key={step.label} variant="caption">
                  <span className="font-medium text-(--color-text-primary)">{step.label}:</span> {step.detail}
                </Text>
              ))}
            </Grid>
            <Inline gap={4} className="mt-8">
              <ButtonLink href="/product/platform" variant="tertiary" prefetch={false}>
                See how the platform connects
              </ButtonLink>
            </Inline>
          </Container>
        </Section>
      </TrackView>

      {/* Module architecture */}
      <TrackView event="module_group_view">
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={MODULE_ARCHITECTURE_SECTION.eyebrow} title={MODULE_ARCHITECTURE_SECTION.heading} description={MODULE_ARCHITECTURE_SECTION.supportingText} />
            <div className="mt-10 flex flex-col">
              {MODULE_NAV_GROUPS.map((group) => {
                const summary = MODULE_ARCHITECTURE_SECTION.groupSummaries.find((item) => item.groupKey === group.key);
                return (
                  <InformationBand key={group.key}>
                    <div className="sm:w-1/3">
                      <Text variant="label">{group.label}</Text>
                      {summary ? (
                        <Text variant="bodySmall" className="mt-1">
                          {summary.outcome}
                        </Text>
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-wrap gap-2 sm:justify-end">
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
                  </InformationBand>
                );
              })}
            </div>
            <Inline gap={4} className="mt-8">
              <ButtonLink href="/modules" variant="tertiary" prefetch={false}>
                See all modules
              </ButtonLink>
            </Inline>
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
            <Grid columns={4} gap={6} className="mt-10">
              {BREADTH_SECTION.breakdown.map((item) => (
                <div key={item.label}>
                  <p className="tabular-data text-3xl font-semibold text-(--color-text-inverse)">{item.value}</p>
                  <p className="mt-1 text-sm font-medium text-white/80">{item.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/60">{item.description}</p>
                </div>
              ))}
            </Grid>
          </Container>
        </Section>
      </TrackView>

      {/* Flagship workflow */}
      <TrackView event="workflow_interaction" properties={{ workflow: FLAGSHIP_WORKFLOW_SECTION.workflowSlug }}>
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={FLAGSHIP_WORKFLOW_SECTION.eyebrow} title={FLAGSHIP_WORKFLOW_SECTION.heading} description={FLAGSHIP_WORKFLOW_SECTION.supportingText} />
            <Grid columns={approvedWorkflowScreenshotIds.length > 0 ? 2 : 1} gap={10} className="mt-10 items-start">
              <ol className={`flex flex-col gap-0 ${approvedWorkflowScreenshotIds.length === 0 ? "max-w-[720px]" : ""}`}>
                {FLAGSHIP_WORKFLOW_SECTION.steps.map((step, index) => (
                  <li key={step.step} className={`flex gap-4 border-(--color-border-default) py-4 ${index > 0 ? "border-t" : ""}`}>
                    <span className="tabular-data flex h-7 w-7 flex-none items-center justify-center rounded-(--radius-control) bg-(--color-bg-brand) text-xs font-semibold text-(--color-text-inverse)">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-(--color-text-primary)">
                        {step.step} <span className="font-normal text-(--color-text-muted)">— {step.department}</span>
                      </p>
                      <p className="mt-0.5 text-sm text-(--color-text-secondary)">{step.systemAction}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {approvedWorkflowScreenshotIds.length > 0 ? (
                <Stack gap={4}>
                  {approvedWorkflowScreenshotIds.map((id) => (
                    <ProductScreenshot key={id} id={id} moduleAccentColor="var(--color-brand)" />
                  ))}
                  <ButtonLink href={`/workflows/${FLAGSHIP_WORKFLOW_SECTION.workflowSlug}`} variant="secondary" prefetch={false}>
                    See the full workflow
                  </ButtonLink>
                </Stack>
              ) : (
                <div className="mt-2">
                  <ButtonLink href={`/workflows/${FLAGSHIP_WORKFLOW_SECTION.workflowSlug}`} variant="secondary" prefetch={false}>
                    See the full workflow
                  </ButtonLink>
                </div>
              )}
            </Grid>
          </Container>
        </Section>
      </TrackView>

      {/* Role-based value */}
      <TrackView event="role_value_view">
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow={ROLE_VALUE_SECTION.eyebrow} title={ROLE_VALUE_SECTION.heading} />
            <Grid columns={3} gap={6} className="mt-10">
              {ROLE_VALUE_SECTION.roles.map((item) => (
                <div key={item.role}>
                  <Text variant="label">{item.role}</Text>
                  <Text variant="bodySmall" className="mt-1.5">
                    {item.gains}
                  </Text>
                </div>
              ))}
            </Grid>
          </Container>
        </Section>
      </TrackView>

      {/* Automation and analytics */}
      <TrackView event="automation_section_view">
        <Section tone="page">
          <Container>
            <Grid columns={2} gap={10} className="items-start">
              <SectionHeader eyebrow={AUTOMATION_SECTION.eyebrow} title={AUTOMATION_SECTION.heading} className="max-w-none" />
              <FeatureList items={AUTOMATION_SECTION.items.map((item) => <><strong className="text-(--color-text-primary)">{item.title}.</strong> {item.description}</>)} />
            </Grid>
          </Container>
        </Section>
      </TrackView>

      {/* Security and governance */}
      <TrackView event="security_section_view">
        <Section tone="elevated">
          <Container>
            <SectionHeader eyebrow={SECURITY_SECTION.eyebrow} title={SECURITY_SECTION.heading} description={SECURITY_SECTION.supportingText} />
            <Grid columns={3} gap={6} className="mt-10">
              {SECURITY_SECTION.items.map((item) => (
                <div key={item.title}>
                  <Text variant="label">{item.title}</Text>
                  <Text variant="bodySmall" className="mt-1.5">
                    {item.description}
                  </Text>
                </div>
              ))}
            </Grid>
            <Inline gap={4} className="mt-8">
              <ButtonLink href="/security" variant="tertiary" prefetch={false}>
                See the security architecture
              </ButtonLink>
            </Inline>
          </Container>
        </Section>
      </TrackView>

      {/* Implementation */}
      <TrackView event="implementation_section_view">
        <Section tone="page">
          <Container>
            <Grid columns={2} gap={10} className="items-start">
              <Stack gap={6}>
                <SectionHeader eyebrow={IMPLEMENTATION_SECTION.eyebrow} title={IMPLEMENTATION_SECTION.heading} description={IMPLEMENTATION_SECTION.supportingText} className="max-w-none" />
                <Inline gap={4}>
                  <TrackedCtaLink href={CTAS.talkToSpecialist.href} event="implementation_specialist_cta_click" ctaLocation="implementation" variant="tertiary">
                    {CTAS.talkToSpecialist.label}
                  </TrackedCtaLink>
                </Inline>
              </Stack>
              <NumberedSteps steps={IMPLEMENTATION_SECTION.steps} />
            </Grid>
          </Container>
        </Section>
      </TrackView>

      {/* Buyer questions */}
      <TrackView event="buyer_questions_view">
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow={BUYER_QUESTIONS_SECTION.eyebrow} title={BUYER_QUESTIONS_SECTION.heading} />
            <FaqAccordion items={BUYER_QUESTIONS_SECTION.questions} className="mt-10 max-w-[820px]" />
          </Container>
        </Section>
      </TrackView>

      {/* Final CTA */}
      <TrackView event="final_cta_view">
        <Section tone="inverse">
          <Container>
            <div className="mx-auto max-w-[640px] text-center">
              <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
                {FINAL_CTA_SECTION.heading}
              </Heading>
              <Text variant="lead" className="mt-3 text-white/70">
                {FINAL_CTA_SECTION.supportingText}
              </Text>
              <div className="mt-6 flex justify-center">
                <TrackedCtaLink href={FINAL_CTA_SECTION.primaryCta.href} event={FINAL_CTA_SECTION.primaryCta.analyticsId} ctaLocation="final_cta">
                  {FINAL_CTA_SECTION.primaryCta.label}
                </TrackedCtaLink>
              </div>
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* Mobile-only spacer so the fixed sticky CTA bar never covers footer content — matches StickyMobileCta's own rendered height including its safe-area inset. */}
      <div className="h-[calc(env(safe-area-inset-bottom)+5rem)] lg:hidden" aria-hidden="true" />
      <StickyMobileCta href={HERO.primaryCta.href} label={HERO.primaryCta.label} event="sticky_mobile_cta_click" />

      {/* Organization/WebSite JSON-LD is rendered once, site-wide, by app/layout.tsx. */}
      <script {...jsonLdScriptProps(softwareApplicationJsonLd)} />
      <script {...jsonLdScriptProps(faqPageJsonLd)} />
    </>
  );
}
