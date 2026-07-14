import { ArrowRight, Check, CheckCircle2 } from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";

import MarketingShell from "./marketing-shell";
import PageHero from "./page-hero";
import SectionHeading from "./section-heading";

export type ContentItem = {
  title: string;
  description: string;
};

export type ContentSection = {
  eyebrow?: string;
  title: string;
  paragraphs?: string[];
  connectedModules?: string;
  items?: ContentItem[];
  bullets?: string[];
  afterBullets?: string;
  steps?: string[];
  stepsLabel?: string;
  outcome?: string;
  outcomeLabel?: string;
  cta?: { label: string; href: string };
  tone?: "white" | "muted" | "dark";
};

export type StructuredPageConfig = {
  hero: {
    eyebrow: string;
    title: string;
    description: string;
    primary: { label: string; href: string };
    secondary: { label: string; href: string };
  };
  sections: ContentSection[];
  finalCta: {
    title: string;
    description: string;
    primary: { label: string; href: string };
    secondary: { label: string; href: string };
  };
};

export default function StructuredContentPage({
  config,
}: {
  config: StructuredPageConfig;
}) {
  return (
    <MarketingShell>
      <PageHero
        eyebrow={config.hero.eyebrow}
        title={config.hero.title}
        description={config.hero.description}
        actions={
          <>
            <Link
              href={config.hero.primary.href}
              className="button-primary w-full sm:w-auto"
            >
              {config.hero.primary.label}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link
              href={config.hero.secondary.href}
              className="button-secondary w-full sm:w-auto"
            >
              {config.hero.secondary.label}
            </Link>
          </>
        }
      />

      {config.sections.map((section, index) => {
        const tone = section.tone ?? (index % 2 === 0 ? "white" : "muted");
        const dark = tone === "dark";
        const background =
          tone === "dark"
            ? "border-y border-slate-800 bg-slate-950"
            : tone === "muted"
              ? "border-y border-slate-200 bg-slate-50"
              : "bg-white";

        return (
          <section
            key={section.title}
            className={background + " py-9 sm:py-16 lg:py-20"}
          >
            <PageContainer>
              <SectionHeading
                eyebrow={section.eyebrow}
                title={section.title}
                description={section.paragraphs?.[0]}
                tone={dark ? "dark" : "light"}
              />

              {section.paragraphs && section.paragraphs.length > 1 ? (
                <div
                  className={
                    "mt-4 max-w-3xl space-y-3 text-xs leading-6 sm:mt-6 sm:text-base sm:leading-7 " +
                    (dark ? "text-slate-300" : "text-slate-600")
                  }
                >
                  {section.paragraphs.slice(1).map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              ) : null}

              {section.connectedModules ? (
                <p
                  className={
                    "mt-4 inline-flex rounded-full px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.12em] sm:mt-6 sm:text-xs " +
                    (dark
                      ? "bg-white/10 text-teal-300"
                      : "bg-indigo-50 text-indigo-700")
                  }
                >
                  Connected modules: {section.connectedModules}
                </p>
              ) : null}

              {section.items ? (
                <div className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-9 sm:gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {section.items.map((item, itemIndex) => (
                    <article
                      key={item.title}
                      className={
                        "min-w-0 rounded-xl border p-3 sm:rounded-2xl sm:p-5 " +
                        (dark
                          ? "border-white/10 bg-white/[0.06]"
                          : "border-slate-200 bg-white")
                      }
                    >
                      <span
                        className={
                          "flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-extrabold sm:h-9 sm:w-9 sm:text-xs " +
                          (dark
                            ? "bg-white/10 text-teal-300"
                            : "bg-indigo-50 text-indigo-600")
                        }
                      >
                        {String(itemIndex + 1).padStart(2, "0")}
                      </span>
                      <h2
                        className={
                          "font-display mt-2.5 text-sm font-extrabold sm:mt-4 sm:text-lg " +
                          (dark ? "text-white" : "text-slate-950")
                        }
                      >
                        {item.title}
                      </h2>
                      <p
                        className={
                          "mt-1.5 text-[11px] leading-5 sm:mt-2 sm:text-sm sm:leading-7 " +
                          (dark ? "text-slate-300" : "text-slate-600")
                        }
                      >
                        {item.description}
                      </p>
                    </article>
                  ))}
                </div>
              ) : null}

              {section.bullets ? (
                <ul className="mt-6 grid grid-cols-2 gap-2 sm:mt-8 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
                  {section.bullets.map((item) => (
                    <li
                      key={item}
                      className={
                        "flex items-start gap-2 rounded-xl border p-3 text-[11px] font-semibold leading-5 sm:rounded-2xl sm:p-4 sm:text-sm sm:leading-6 " +
                        (dark
                          ? "border-white/10 bg-white/[0.06] text-slate-200"
                          : "border-slate-200 bg-white text-slate-700")
                      }
                    >
                      <Check
                        aria-hidden="true"
                        className={
                          "mt-0.5 h-3.5 w-3.5 shrink-0 sm:h-5 sm:w-5 " +
                          (dark ? "text-teal-300" : "text-emerald-600")
                        }
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}

              {section.afterBullets ? (
                <p
                  className={
                    "mt-5 max-w-3xl text-xs leading-6 sm:mt-6 sm:text-base sm:leading-7 " +
                    (dark ? "text-slate-300" : "text-slate-600")
                  }
                >
                  {section.afterBullets}
                </p>
              ) : null}

              {section.steps ? (
                <div className="mt-6 sm:mt-8">
                  {section.stepsLabel || section.connectedModules ? (
                    <p
                      className={
                        "mb-3 text-xs font-extrabold sm:mb-4 sm:text-sm " +
                        (dark ? "text-white" : "text-slate-900")
                      }
                    >
                      {section.stepsLabel ?? "Workflow stages"}
                    </p>
                  ) : null}
                  <ol className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
                    {section.steps.map((step, stepIndex) => (
                      <li
                        key={step}
                        className={
                          "rounded-xl border p-3 sm:rounded-2xl sm:p-4 " +
                          (dark
                            ? "border-white/10 bg-white/[0.06]"
                            : "border-slate-200 bg-white")
                        }
                      >
                        <span
                          className={
                            "text-[10px] font-extrabold sm:text-xs " +
                            (dark ? "text-teal-300" : "text-indigo-600")
                          }
                        >
                          {String(stepIndex + 1).padStart(2, "0")}
                        </span>
                        <p
                          className={
                            "mt-1.5 text-[11px] font-bold leading-5 sm:mt-2 sm:text-sm sm:leading-6 " +
                            (dark ? "text-white" : "text-slate-800")
                          }
                        >
                          {step}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {section.outcome ? (
                <div
                  className={
                    "mt-6 flex items-start gap-3 rounded-xl border p-4 sm:mt-8 sm:rounded-2xl sm:p-5 " +
                    (dark
                      ? "border-teal-400/20 bg-teal-400/10"
                      : "border-emerald-200 bg-emerald-50")
                  }
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className={
                      "mt-0.5 h-5 w-5 shrink-0 " +
                      (dark ? "text-teal-300" : "text-emerald-600")
                    }
                  />
                  <div>
                    <p
                      className={
                        "text-[10px] font-extrabold uppercase tracking-[0.12em] sm:text-xs " +
                        (dark ? "text-teal-300" : "text-emerald-700")
                      }
                    >
                      {section.outcomeLabel ??
                        (section.connectedModules
                          ? "Business outcome"
                          : "Outcome")}
                    </p>
                    <p
                      className={
                        "mt-1 text-xs font-semibold leading-6 sm:text-sm " +
                        (dark ? "text-slate-200" : "text-slate-700")
                      }
                    >
                      {section.outcome}
                    </p>
                  </div>
                </div>
              ) : null}

              {section.cta ? (
                <Link
                  href={section.cta.href}
                  className="button-secondary mt-6 text-xs sm:mt-8 sm:text-sm"
                >
                  {section.cta.label}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              ) : null}
            </PageContainer>
          </section>
        );
      })}

      <section className="bg-white py-9 sm:py-16 lg:py-20">
        <PageContainer>
          <div className="relative overflow-hidden rounded-2xl bg-slate-950 px-4 py-8 text-center text-white sm:rounded-[2rem] sm:px-10 sm:py-14">
            <div className="relative mx-auto max-w-3xl">
              <h2 className="font-display text-2xl font-extrabold tracking-[-0.04em] sm:text-4xl">
                {config.finalCta.title}
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-xs leading-6 text-slate-300 sm:mt-5 sm:text-base sm:leading-7">
                {config.finalCta.description}
              </p>
              <div className="mt-5 flex flex-col justify-center gap-2.5 sm:mt-8 sm:flex-row sm:gap-3">
                <Link
                  href={config.finalCta.primary.href}
                  className="button-primary min-h-11 w-full text-xs sm:min-h-[52px] sm:w-auto sm:text-sm"
                >
                  {config.finalCta.primary.label}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
                <Link
                  href={config.finalCta.secondary.href}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 text-xs font-extrabold text-white sm:min-h-[52px] sm:w-auto sm:px-6 sm:text-sm"
                >
                  {config.finalCta.secondary.label}
                </Link>
              </div>
            </div>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
