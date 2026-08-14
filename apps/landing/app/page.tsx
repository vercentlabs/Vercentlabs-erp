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
import { Container, Section, SectionHeader, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ButtonLink } from "@/components/ui/button";
import { ProductScreenshot } from "@/components/product/product-frame";
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
  const implementedCapabilities = HERO.evidence.find((item) => item.label === "Implemented capabilities")?.value;

  return (
    <>
      <HomepageViewTracker />

      <TrackView event="hero_view">
        <Section
          tone="page"
          paddingTop={{ base: 10, sm: 14, lg: 16 }}
          paddingBottom={{ base: 14, sm: 18, lg: 20 }}
          className="overflow-hidden"
        >
          <Container>
            <div className="reveal-on-load">
              <Text variant="eyebrow">{HERO.eyebrow}</Text>

              <div className="mt-7 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,.75fr)] lg:items-end lg:gap-14">
                <Heading level="display" className="max-w-[10.8ch]">
                  {HERO.heading}
                </Heading>
                <div className="max-w-[610px] lg:pb-1">
                  <Text variant="lead">{HERO.supportingText}</Text>
                  <Inline gap={3} className="mt-7">
                    <TrackedCtaLink href={HERO.primaryCta.href} event={HERO.primaryCta.analyticsId} ctaLocation="hero">
                      {HERO.primaryCta.label}
                    </TrackedCtaLink>
                    <TrackedCtaLink
                      href={HERO.secondaryCta.href}
                      event={HERO.secondaryCta.analyticsId}
                      ctaLocation="hero"
                      variant="secondary"
                    >
                      {HERO.secondaryCta.label}
                    </TrackedCtaLink>
                  </Inline>
                </div>
              </div>

              <dl className="mt-12 grid grid-cols-2 border-t border-(--color-border-strong) sm:grid-cols-4 lg:mt-14">
                {HERO.evidence.map((item, index) => (
                  <div
                    key={item.label}
                    className="min-w-0 border-b border-(--color-border-default) py-4 pr-4 sm:border-b-0 sm:border-r sm:px-5 sm:first:pl-0 sm:last:border-r-0"
                  >
                    <dd className="tabular-data truncate text-[clamp(1.55rem,2.5vw,2.2rem)] font-semibold leading-none tracking-[-0.055em] text-(--color-text-primary)">
                      {item.value}
                    </dd>
                    <dt className="vl-index mt-3">{String(index + 1).padStart(2, "0")} / {item.label}</dt>
                  </div>
                ))}
              </dl>
            </div>

            {hasHeroScreenshot ? (
              <div className="vl-product-stage reveal-on-load reveal-on-load-delay-1 mt-7 sm:mt-9">
                <ProductScreenshot id={HERO.screenshotId} moduleAccentColor="var(--vl-brand)" priority />
              </div>
            ) : null}
          </Container>
        </Section>
      </TrackView>

      <TrackView event="problem_section_view">
        <Section tone="page">
          <Container>
            <SectionHeader
              eyebrow={PROBLEM_SECTION.eyebrow}
              title={PROBLEM_SECTION.heading}
              description={PROBLEM_SECTION.supportingText}
            />
            <div className="mt-12 grid grid-cols-1 gap-x-14 lg:grid-cols-2 xl:gap-x-20">
              {PROBLEM_SECTION.items.map((item, index) => (
                <article
                  key={item.title}
                  className="grid min-h-32 grid-cols-[42px_1fr] gap-4 border-t border-(--color-border-default) py-5 lg:py-6 lg:even:translate-y-10"
                >
                  <span className="vl-index pt-1 text-(--vl-signal)" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-[1.04rem] font-semibold tracking-[-0.025em] text-(--color-text-primary)">{item.title}</h3>
                    <p className="mt-2 max-w-[58ch] text-sm leading-[1.72] text-(--color-text-secondary)">{item.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </Container>
        </Section>
      </TrackView>

      <TrackView event="workflow_view" properties={{ section: "connected-system" }}>
        <Section tone="inverse" className="vl-noise-free">
          <Container>
            <div className="grid grid-cols-1 gap-8 border-t border-white/25 pt-5 lg:grid-cols-[150px_minmax(0,1fr)] lg:gap-12">
              <p className="vl-kicker text-white before:bg-white">{CONNECTED_SYSTEM_SECTION.eyebrow}</p>
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)] xl:gap-12">
                <Heading level="h1" as="h2" className="max-w-[13ch] text-white">
                  {CONNECTED_SYSTEM_SECTION.heading}
                </Heading>
                <Text variant="lead" className="self-end text-white/65">
                  {CONNECTED_SYSTEM_SECTION.supportingText}
                </Text>
              </div>
            </div>

            <ol className="relative mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8" aria-label="Connected ERP record flow">
              <span className="absolute left-[3%] right-[3%] top-[18px] hidden h-px bg-white/25 xl:block" aria-hidden="true" />
              {CONNECTED_SYSTEM_SECTION.steps.map((step, index) => {
                const moduleInfo = LANDING_MODULES.find((candidate) => candidate.key === step.module);
                const accentColor = moduleInfo?.accentColor.hex ?? "#ffffff";
                return (
                  <li key={step.label} className="relative border-t border-white/15 py-5 pr-5 sm:min-h-48 sm:border-r sm:px-5 sm:last:border-r-0 xl:border-t-0 xl:px-2 xl:pt-0">
                    <span
                      className="relative z-10 mb-7 block h-[9px] w-[9px] outline outline-4 outline-(--vl-night) xl:mb-8"
                      style={{ backgroundColor: accentColor }}
                      aria-hidden="true"
                    />
                    <span className="vl-index text-white/45">{String(index + 1).padStart(2, "0")} / {moduleInfo?.name ?? step.module}</span>
                    <h3 className="mt-3 text-sm font-semibold text-white">{step.label}</h3>
                    <p className="mt-2 text-[0.78rem] leading-[1.6] text-white/55">{step.detail}</p>
                  </li>
                );
              })}
            </ol>

            <div className="mt-8 flex justify-end border-t border-white/20 pt-5">
              <TrackedCtaLink href="/product/platform" event="platform_cta_click" ctaLocation="connected_system" variant="inverse">
                Explore the Platform
              </TrackedCtaLink>
            </div>
          </Container>
        </Section>
      </TrackView>

      <TrackView event="module_group_view">
        <Section tone="page">
          <Container>
            <SectionHeader
              eyebrow={MODULE_ARCHITECTURE_SECTION.eyebrow}
              title={MODULE_ARCHITECTURE_SECTION.heading}
              description={MODULE_ARCHITECTURE_SECTION.supportingText}
            />

            <div className="mt-12 border-t border-(--color-border-strong)">
              {MODULE_NAV_GROUPS.map((group, index) => {
                const summary = MODULE_ARCHITECTURE_SECTION.groupSummaries.find((item) => item.groupKey === group.key);
                return (
                  <section
                    key={group.key}
                    className="grid grid-cols-1 gap-4 border-b border-(--color-border-default) py-6 lg:grid-cols-[150px_minmax(230px,.8fr)_minmax(0,1.35fr)] lg:gap-10 lg:py-7"
                  >
                    <div className="flex items-baseline gap-3 lg:block">
                      <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                      <h3 className="mt-2 text-sm font-semibold text-(--color-text-primary)">{group.label}</h3>
                    </div>
                    <p className="max-w-[48ch] text-sm leading-[1.65] text-(--color-text-secondary)">{summary?.outcome}</p>
                    <div className="flex flex-wrap content-start gap-2 lg:justify-start">
                      {group.moduleKeys.map((key) => {
                        const moduleInfo = LANDING_MODULES.find((candidate) => candidate.key === key);
                        if (!moduleInfo) return null;
                        return (
                          <Link
                            key={moduleInfo.key}
                            href={`/modules/${moduleInfo.key}`}
                            prefetch={false}
                            className="group inline-flex items-center gap-2 border border-(--color-border-strong) bg-(--color-bg-elevated) px-3 py-2 text-xs font-semibold text-(--color-text-primary) transition-colors hover:border-(--color-text-primary) hover:bg-(--color-bg-elevated)"
                          >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: moduleInfo.accentColor.hex }} aria-hidden="true" />
                            {moduleInfo.name}
                            <span className="vl-hover-arrow text-(--color-text-muted)" aria-hidden="true">→</span>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="mt-5 flex justify-end">
              <ButtonLink href="/modules" variant="tertiary" prefetch={false}>
                See all modules
              </ButtonLink>
            </div>
          </Container>
        </Section>
      </TrackView>

      <TrackView event="breadth_section_view">
        <Section tone="elevated">
          <Container>
            <SectionHeader eyebrow={BREADTH_SECTION.eyebrow} title={BREADTH_SECTION.heading} description={BREADTH_SECTION.supportingText} />
            <div className="mt-14 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,.6fr)] lg:items-end lg:gap-16">
              <div>
                <p className="tabular-data text-[clamp(5.4rem,14vw,11.5rem)] font-semibold leading-[0.72] tracking-[-0.085em] text-(--color-text-primary)">
                  {implementedCapabilities}
                </p>
                <p className="vl-index mt-8">{HERO.evidence.find((item) => item.label === "Implemented capabilities")?.label}</p>
              </div>
              <dl className="border-t border-(--color-border-strong)">
                {BREADTH_SECTION.breakdown.map((item) => (
                  <div key={item.label} className="grid grid-cols-[minmax(86px,.34fr)_minmax(0,1fr)] gap-5 border-b border-(--color-border-default) py-4">
                    <dt className="tabular-data text-xl font-semibold tracking-[-0.04em] text-(--color-text-primary)">{item.value}</dt>
                    <dd>
                      <p className="text-xs font-semibold text-(--color-text-primary)">{item.label}</p>
                      <p className="mt-1 text-xs leading-[1.6] text-(--color-text-secondary)">{item.description}</p>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </Container>
        </Section>
      </TrackView>

      <TrackView event="workflow_interaction" properties={{ workflow: FLAGSHIP_WORKFLOW_SECTION.workflowSlug }}>
        <Section tone="page">
          <Container>
            <SectionHeader
              eyebrow={FLAGSHIP_WORKFLOW_SECTION.eyebrow}
              title={FLAGSHIP_WORKFLOW_SECTION.heading}
              description={FLAGSHIP_WORKFLOW_SECTION.supportingText}
            />
            <div className="mt-14">
              <FlagshipWorkflow steps={FLAGSHIP_WORKFLOW_SECTION.steps} workflowSlug={FLAGSHIP_WORKFLOW_SECTION.workflowSlug} />
            </div>
          </Container>
        </Section>
      </TrackView>

      <TrackView event="role_value_view">
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow={ROLE_VALUE_SECTION.eyebrow} title={ROLE_VALUE_SECTION.heading} />
            <div className="mt-12 grid grid-cols-1 gap-x-14 lg:grid-cols-2 xl:gap-x-20">
              {ROLE_VALUE_SECTION.roles.map((item, index) => (
                <div key={item.role} className="grid grid-cols-[42px_1fr] gap-4 border-t border-(--color-border-strong) py-5 lg:min-h-36 lg:py-6">
                  <span className="vl-index pt-1 text-(--color-text-brand)" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="text-base font-semibold tracking-[-0.025em] text-(--color-text-primary)">{item.role}</h3>
                    <p className="mt-3 max-w-[58ch] text-sm leading-[1.7] text-(--color-text-secondary)">{item.gains}</p>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </Section>
      </TrackView>

      <TrackView event="automation_section_view">
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={AUTOMATION_SECTION.eyebrow} title={AUTOMATION_SECTION.heading} />
            <ol className="mt-12 grid grid-cols-1 border-t border-(--color-border-strong) md:grid-cols-2 lg:grid-cols-5">
              {AUTOMATION_SECTION.items.map((item, index) => (
                <li key={item.title} className="border-b border-(--color-border-default) py-6 md:border-r md:px-5 md:first:pl-0 lg:min-h-64 lg:last:border-r-0">
                  <span className="tabular-data text-4xl font-semibold tracking-[-0.06em] text-(--color-text-brand)" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-8 text-sm font-semibold text-(--color-text-primary)">{item.title}</h3>
                  <p className="mt-3 text-xs leading-[1.65] text-(--color-text-secondary)">{item.description}</p>
                </li>
              ))}
            </ol>
          </Container>
        </Section>
      </TrackView>

      <TrackView event="security_section_view">
        <Section tone="inverse" className="vl-noise-free">
          <Container>
            <div className="grid grid-cols-1 gap-12 border-t border-white/25 pt-5 lg:grid-cols-[minmax(280px,.7fr)_minmax(0,1.3fr)] lg:gap-16">
              <div>
                <p className="vl-kicker text-white before:bg-white">{SECURITY_SECTION.eyebrow}</p>
                <Heading level="h1" as="h2" className="mt-6 max-w-[11ch] text-white">{SECURITY_SECTION.heading}</Heading>
                <Text variant="lead" className="mt-6 text-white/62">{SECURITY_SECTION.supportingText}</Text>
                <ButtonLink href="/security" variant="inverse" prefetch={false} className="mt-8">
                  See the security architecture →
                </ButtonLink>
              </div>
              <div className="grid grid-cols-1 border-t border-white/20 sm:grid-cols-2">
                {SECURITY_SECTION.items.map((item, index) => (
                  <div key={item.title} className="min-h-44 border-b border-white/15 py-5 sm:border-r sm:px-5 sm:even:border-r-0">
                    <span className="vl-index text-white/42">{String(index + 1).padStart(2, "0")}</span>
                    <h3 className="mt-7 text-sm font-semibold text-white">{item.title}</h3>
                    <p className="mt-2 text-xs leading-[1.65] text-white/55">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </Section>
      </TrackView>

      <TrackView event="implementation_section_view">
        <Section tone="page">
          <Container>
            <SectionHeader
              eyebrow={IMPLEMENTATION_SECTION.eyebrow}
              title={IMPLEMENTATION_SECTION.heading}
              description={IMPLEMENTATION_SECTION.supportingText}
            />
            <div className="mt-14 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(250px,.55fr)_minmax(0,1.45fr)] lg:gap-16">
              <div className="lg:pt-1">
                <span className="vl-index text-(--color-text-brand)">01—{String(IMPLEMENTATION_SECTION.steps.length).padStart(2, "0")}</span>
                <div className="mt-5 h-[3px] w-20 bg-(--vl-brand)" aria-hidden="true" />
                <div className="mt-7">
                  <TrackedCtaLink
                    href={CTAS.talkToSpecialist.href}
                    event="implementation_specialist_cta_click"
                    ctaLocation="implementation"
                    variant="secondary"
                  >
                    {CTAS.talkToSpecialist.label}
                  </TrackedCtaLink>
                </div>
              </div>
              <ol className="border-t border-(--color-border-strong)">
                {IMPLEMENTATION_SECTION.steps.map((item) => (
                  <li key={item.step} className="grid grid-cols-[48px_1fr] gap-4 border-b border-(--color-border-default) py-5 sm:grid-cols-[64px_180px_1fr] sm:gap-6">
                    <span className="vl-index pt-1 text-(--color-text-brand)">{item.step}</span>
                    <h3 className="text-sm font-semibold text-(--color-text-primary)">{item.title}</h3>
                    <p className="col-start-2 text-sm leading-[1.68] text-(--color-text-secondary) sm:col-start-3">{item.description}</p>
                  </li>
                ))}
              </ol>
            </div>
          </Container>
        </Section>
      </TrackView>

      <TrackView event="buyer_questions_view">
        <Section tone="subtle">
          <Container>
            <div className="grid grid-cols-1 gap-10 border-t border-(--color-border-strong) pt-5 lg:grid-cols-[minmax(280px,.65fr)_minmax(0,1.35fr)] lg:gap-16">
              <div>
                <p className="vl-kicker">{BUYER_QUESTIONS_SECTION.eyebrow}</p>
                <Heading level="h1" as="h2" className="mt-6 max-w-[11ch]">{BUYER_QUESTIONS_SECTION.heading}</Heading>
              </div>
              <FaqAccordion items={BUYER_QUESTIONS_SECTION.questions} reveal={false} />
            </div>
          </Container>
        </Section>
      </TrackView>

      <TrackView event="final_cta_view">
        <Section
          tone="brand"
          paddingTop={{ base: 16, sm: 20, lg: 24 }}
          paddingBottom={{ base: 16, sm: 20, lg: 24 }}
          className="text-white"
        >
          <Container>
            <div className="grid grid-cols-1 items-end gap-10 border-t border-white/35 pt-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
              <div>
                <p className="vl-kicker text-white before:bg-white">Built around your workflow</p>
                <Heading level="h1" as="h2" className="mt-7 max-w-[14ch] text-white">{FINAL_CTA_SECTION.heading}</Heading>
                <Text variant="lead" className="mt-6 max-w-[62ch] text-white/68">{FINAL_CTA_SECTION.supportingText}</Text>
              </div>
              <TrackedCtaLink
                href={FINAL_CTA_SECTION.primaryCta.href}
                event={FINAL_CTA_SECTION.primaryCta.analyticsId}
                ctaLocation="final_cta"
                variant="inverse"
              >
                {FINAL_CTA_SECTION.primaryCta.label}
              </TrackedCtaLink>
            </div>
          </Container>
        </Section>
      </TrackView>

      <script {...jsonLdScriptProps(softwareApplicationJsonLd)} />
      <script {...jsonLdScriptProps(faqPageJsonLd)} />
    </>
  );
}
