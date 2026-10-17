

import Link from "next/link";
import { getLandingModule, type PlatformPageContent } from "@vercentlabs/landing-content";
import { TrackView } from "@/components/analytics/track-view";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Container, Section, SectionHeader, SplitLayout, Stack } from "@/components/layout/container";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import { jsonLdScriptProps, type BreadcrumbEntry } from "@/lib/seo/json-ld";

interface EvidenceVisual {
  eyebrow: string;
  stat: string;
  statLabel: string;
  items: { label: string; detail: string; color: string }[];
  definitionLabel: string;
  bodyEyebrow: string;
  bodyTitle: string;
  bodyDescription: string;
  moduleEyebrow: string;
  moduleTitle: string;
}

export function EvidencePlatformPageTemplate({
  content,
  breadcrumbTrail,
  visual,
}: {
  content: PlatformPageContent;
  breadcrumbTrail: BreadcrumbEntry[];
  visual: EvidenceVisual;
}) {
  const familyLabel = content.slug === "/security" ? "CONTROL LEDGER / SECURITY" : content.slug.includes("mobile") ? "FIELD MANUAL / MOBILE" : content.slug.includes("integrations") ? "INTERFACE CONTRACT / INTEGRATIONS" : "PLATFORM EVIDENCE / REGISTER";
  const connectedModules = content.connectedModuleKeys
    .map((key) => getLandingModule(key))
    .filter((module): module is NonNullable<typeof module> => Boolean(module));
  const faqPageJsonLd = content.faqs?.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: content.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      }
    : null;

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
                  <span className="vl-folio">{familyLabel}</span>
                  <Text variant="eyebrow">{content.eyebrow}</Text>
                  <Heading level="display" as="h1">{content.heading}</Heading>
                  <Text variant="lead">{content.supportingText}</Text>
                  <div>
                    <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation={`${content.slug}_hero`}>
                      {content.primaryCta.label}
                    </TrackedCtaLink>
                  </div>
                </Stack>
              }
              secondary={
                <div className="reveal-on-load reveal-on-load-delay-1 lg:pl-6">
                  <div className="flex items-end justify-between gap-4 border-b border-(--color-border-default) pb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">{visual.eyebrow}</p>
                      <p className="mt-1 text-sm text-(--color-text-secondary)">{visual.statLabel}</p>
                    </div>
                    <span className="tabular-data text-3xl font-semibold tracking-[-0.04em] text-(--color-text-primary)">{visual.stat}</span>
                  </div>
                  <ol className="relative mt-6 border-l-2 border-(--color-border-brand)">
                    {visual.items.map((item, index) => (
                      <li key={item.label} className="relative py-3 pl-9 first:pt-0 last:pb-0">
                        <span
                          className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-[3px] text-[0.68rem] font-semibold text-(--color-text-inverse) ${index === 0 ? "top-0" : "top-3"}`}
                          style={{ backgroundColor: item.color }}
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                        <p className="text-sm font-semibold text-(--color-text-primary)">{item.label}</p>
                        <p className="mt-1 text-xs leading-relaxed text-(--color-text-secondary)">{item.detail}</p>
                      </li>
                    ))}
                  </ol>
                  {connectedModules.length > 0 ? (
                    <div className="mt-7 border-t border-(--color-border-default) pt-5">
                      <p className="text-xs font-medium uppercase tracking-[0.08em] text-(--color-text-muted)">Connected modules</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {connectedModules.map((module) => (
                          <Link key={module.key} href={`/modules/${module.key}`} prefetch={false}>
                            <ModuleTag name={module.name} accentColor={module.accentColor.hex} />
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              }
            />
            <div className="mt-12 grid grid-cols-1 gap-4 border-t border-(--color-border-default) pt-8 lg:grid-cols-[220px_minmax(0,820px)] lg:gap-12">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">{visual.definitionLabel}</p>
              <p className="text-base font-medium leading-relaxed text-(--color-text-primary)">{content.directDefinition}</p>
            </div>
          </Container>
        </Section>
      </TrackView>

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow={visual.bodyEyebrow} title={visual.bodyTitle} description={visual.bodyDescription} />
          <div className="mt-10 border-y border-(--color-border-strong) bg-(--color-bg-elevated)">
            {content.sections.map((section, index) => (
              <section key={section.id} id={section.id} className="grid grid-cols-1 gap-5 border-t border-(--color-border-default) px-5 py-7 first:border-t-0 sm:px-6 lg:grid-cols-[64px_320px_minmax(0,1fr)] lg:gap-8 lg:px-8">
                <span className="tabular-data text-xs font-semibold tracking-[0.08em] text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.03em] text-(--color-text-primary)">{section.heading}</h2>
                  {section.supportingText && section.items.length > 0 ? <p className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{section.supportingText}</p> : null}
                </div>
                {section.items.length > 0 ? (
                  <div className={`grid grid-cols-1 gap-px border-l border-t border-(--color-border-default) bg-(--color-border-default) lg:self-start ${section.items.length > 2 ? "xl:grid-cols-3" : section.items.length > 1 ? "sm:grid-cols-2" : ""}`}>
                    {section.items.map((item) => (
                      <div key={item.title} className="bg-(--color-bg-subtle) p-4">
                        <span className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-(--color-bg-elevated) text-(--color-text-brand)" aria-hidden="true">
                          <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5"><path d="m5 10 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </span>
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

      {connectedModules.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow={visual.moduleEyebrow} title={visual.moduleTitle} />
            <div className={`mt-10 grid grid-cols-1 gap-px border-l border-t border-(--color-border-strong) bg-(--color-border-default) ${connectedModules.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
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

      {content.faqs?.length ? (
        <Section tone="page">
          <Container>
            <div className="grid grid-cols-1 gap-10 border-y border-(--color-border-strong) bg-(--color-bg-elevated) py-8 lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
              <SectionHeader eyebrow="Straight answers" title={`Questions about ${content.title.toLowerCase()}`} />
              <FaqAccordion items={content.faqs} reveal={false} />
            </div>
          </Container>
        </Section>
      ) : null}

      <Section tone="inverse">
        <Container>
          <div className="grid grid-cols-1 items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">{content.finalCtaHeading}</Heading>
            <TrackedCtaLink href={content.primaryCta.href} event="platform_cta_click" ctaLocation={`${content.slug}_final`}>{content.primaryCta.label}</TrackedCtaLink>
          </div>
        </Container>
      </Section>
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
