import Link from "next/link";
import { getLandingModule } from "@vercentlabs/landing-content";
import { cx } from "@/lib/utils";
import { Container, Section, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import type { AnalyticsEventName } from "@/lib/analytics";

export type PlatformHeroVariant = "platform" | "product" | "industry" | "solution" | "workflow" | "security" | "evidence";

const FOLIO: Record<PlatformHeroVariant, string> = {
  platform: "SYSTEM BLUEPRINT",
  product: "PLATFORM MAP",
  industry: "FIELD MODEL",
  solution: "DIAGNOSTIC",
  workflow: "PROCESS RUNBOOK",
  security: "CONTROL REGISTER",
  evidence: "EVIDENCE FILE",
};

export function PlatformHero({
  eyebrow,
  heading,
  supportingText,
  connectedModuleKeys,
  ctaHref,
  ctaLabel,
  ctaEvent,
  ctaLocation,
  className,
  variant = "platform",
}: {
  eyebrow: string;
  heading: string;
  supportingText: string;
  heroScreenshotId?: string;
  className?: string;
  connectedModuleKeys?: string[];
  ctaHref: string;
  ctaLabel: string;
  ctaEvent: AnalyticsEventName;
  ctaLocation: string;
  variant?: PlatformHeroVariant;
}) {
  const relatedModules = connectedModuleKeys
    ? connectedModuleKeys.map((key) => getLandingModule(key)).filter((m): m is NonNullable<typeof m> => Boolean(m))
    : [];

  const signalColor = variant === "solution" ? "var(--vl-signal)" : "var(--vl-brand)";

  return (
    <Section tone="page" paddingTop={{ base: 8, sm: 12 }} paddingBottom={{ base: 12, sm: 18 }} className={cx("overflow-hidden", className)}>
      <Container>
        <div className="reveal-on-load border-t border-(--color-border-strong) pt-5" data-page-family={variant}>
          <div className="flex items-center justify-between gap-4">
            <Text variant="eyebrow">{eyebrow}</Text>
            <span className="vl-folio hidden sm:flex">{FOLIO[variant]}</span>
          </div>

          {variant === "workflow" ? (
            <>
              <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)] lg:items-end lg:gap-16">
                <div>
                  <span className="vl-index">START → CONTROL → HANDOFF → CLOSE</span>
                  <Heading level="display" as="h1" className="mt-4 max-w-[10ch]">{heading}</Heading>
                </div>
                <div className="border-l border-(--color-border-strong) pl-5 sm:pl-7">
                  <Text variant="lead">{supportingText}</Text>
                  <Inline gap={3} className="mt-6">
                    <TrackedCtaLink href={ctaHref} event={ctaEvent} ctaLocation={ctaLocation}>{ctaLabel}</TrackedCtaLink>
                  </Inline>
                </div>
              </div>
              <div className="mt-10 border-y border-(--color-border-strong) py-5">
                <ol className="grid grid-cols-2 sm:grid-cols-4">
                  {["Trigger", "Work", "Govern", "Outcome"].map((label, index) => (
                    <li key={label} className="border-l border-(--color-border-default) px-4 py-2 first:border-l-0">
                      <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                      <p className="mt-2 text-sm font-semibold text-(--color-text-primary)">{label}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          ) : variant === "industry" ? (
            <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)] lg:items-stretch lg:gap-16">
              <div className="flex flex-col justify-between border-b border-(--color-border-strong) pb-8 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-12">
                <div>
                  <span className="vl-index">OPERATING ENVIRONMENT / FIELD NOTE</span>
                  <Heading level="display" as="h1" className="mt-4 max-w-[9ch]">{heading}</Heading>
                </div>
                <Text variant="lead" className="mt-8 max-w-[58ch]">{supportingText}</Text>
              </div>
              <div className="flex flex-col justify-end">
                <div className="mb-7 flex items-end justify-between border-b border-(--color-border-strong) pb-4">
                  <div>
                    <span className="vl-index">Recommended operating stack</span>
                    <p className="mt-1 text-sm font-semibold text-(--color-text-primary)">Connected modules for this model</p>
                  </div>
                  <span className="font-mono text-5xl font-semibold leading-none tracking-[-0.08em] text-(--color-text-primary)">{String(relatedModules.length).padStart(2, "0")}</span>
                </div>
                <ModuleRegister modules={relatedModules} />
                <Inline gap={3} className="mt-7">
                  <TrackedCtaLink href={ctaHref} event={ctaEvent} ctaLocation={ctaLocation}>{ctaLabel}</TrackedCtaLink>
                </Inline>
              </div>
            </div>
          ) : variant === "solution" ? (
            <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,.6fr)] lg:items-end lg:gap-16">
              <div>
                <span className="block h-[3px] w-16" style={{ backgroundColor: signalColor }} aria-hidden="true" />
                <span className="vl-index mt-5 block">PROBLEM / INTERVENTION / CONTROL</span>
                <Heading level="display" as="h1" className="mt-4 max-w-[10ch]">{heading}</Heading>
                <Text variant="lead" className="mt-6 max-w-[62ch]">{supportingText}</Text>
                <Inline gap={3} className="mt-7">
                  <TrackedCtaLink href={ctaHref} event={ctaEvent} ctaLocation={ctaLocation}>{ctaLabel}</TrackedCtaLink>
                </Inline>
              </div>
              <aside className="border-l-[3px] border-l-(--vl-signal) bg-(--color-bg-elevated) p-5 sm:p-6">
                <span className="vl-index">Affected operating surfaces</span>
                <ModuleRegister modules={relatedModules} compact />
              </aside>
            </div>
          ) : (
            <>
              <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.65fr)] lg:items-end lg:gap-16">
                <div>
                  {variant === "security" ? <span className="vl-index">ACCESS / APPROVAL / AUDIT / ISOLATION</span> : null}
                  {variant === "product" ? <span className="vl-index">ONE DATA MODEL / CONNECTED OPERATIONS</span> : null}
                  <Heading level="display" as="h1" className={cx("max-w-[11ch]", (variant === "security" || variant === "evidence") && "mt-4")}>{heading}</Heading>
                  <Text variant="lead" className="mt-6 max-w-[62ch]">{supportingText}</Text>
                  <Inline gap={3} className="mt-7">
                    <TrackedCtaLink href={ctaHref} event={ctaEvent} ctaLocation={ctaLocation}>{ctaLabel}</TrackedCtaLink>
                  </Inline>
                </div>

                <aside className={cx("border-t border-(--color-border-strong) pt-4", variant === "security" && "border-l border-l-(--color-border-strong) pl-5")} aria-label="Connected module register">
                  <div className="flex items-end justify-between gap-4 border-b border-(--color-border-default) pb-4">
                    <div>
                      <span className="vl-index">{variant === "security" ? "Control coverage" : "Connected register"}</span>
                      <p className="mt-1 text-sm font-semibold text-(--color-text-primary)">{variant === "security" ? "Surfaces governed by this layer" : "Modules in this operating model"}</p>
                    </div>
                    <span className="tabular-data text-5xl font-semibold leading-none tracking-[-0.07em] text-(--color-text-primary)">{String(relatedModules.length).padStart(2, "0")}</span>
                  </div>
                  <ModuleRegister modules={relatedModules} />
                  {relatedModules.length === 0 ? <Text variant="bodySmall" className="py-5">The operating model is documented in the structured sections below.</Text> : null}
                </aside>
              </div>

              {relatedModules.length > 1 ? (
                <div className="mt-12 border-y border-(--color-border-strong) py-4">
                  <div className="grid grid-cols-[auto_1fr] items-center gap-5">
                    <span className="vl-index">System path</span>
                    <ol className="flex min-w-0 flex-wrap items-center gap-y-2">
                      {relatedModules.slice(0, 6).map((moduleInfo, index) => (
                        <li key={moduleInfo.key} className="flex min-w-0 items-center">
                          <span className="h-2 w-2 shrink-0" style={{ backgroundColor: moduleInfo.accentColor.hex }} aria-hidden="true" />
                          <span className="ml-2 text-xs font-semibold text-(--color-text-primary)">{moduleInfo.name}</span>
                          {index < Math.min(relatedModules.length, 6) - 1 ? <span className="mx-3 text-(--color-text-muted)" aria-hidden="true">→</span> : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Container>
    </Section>
  );
}

function ModuleRegister({ modules, compact = false }: { modules: Array<NonNullable<ReturnType<typeof getLandingModule>>>; compact?: boolean }) {
  if (modules.length === 0) return null;
  return (
    <ol className={compact ? "mt-4" : undefined}>
      {modules.slice(0, 6).map((moduleInfo, index) => (
        <li key={moduleInfo.key}>
          <Link href={`/modules/${moduleInfo.key}`} prefetch={false} className="group grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-(--color-border-default) py-3.5">
            <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
            <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
            <span className="vl-hover-arrow text-xs text-(--color-text-muted)">→</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
