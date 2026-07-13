import type { ReactNode } from "react";

import PageContainer from "@/components/layout/page-container";
import RevealOnScroll from "@/components/ui/reveal-on-scroll";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export default function PageHero({
  eyebrow,
  title,
  description,
  actions,
}: PageHeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-white py-14 sm:py-18 lg:py-20">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "linear-gradient(rgba(99,102,241,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.055) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "linear-gradient(to bottom, black, transparent 85%)",
        }}
      />

      <div
        aria-hidden="true"
        className="absolute -left-24 top-2 h-64 w-64 rounded-full bg-indigo-200/55 blur-[100px]"
      />

      <div
        aria-hidden="true"
        className="absolute -right-20 bottom-0 h-64 w-64 rounded-full bg-teal-200/45 blur-[100px]"
      />

      <PageContainer className="relative">
        <RevealOnScroll>
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.17em] text-indigo-700">
              {eyebrow}
            </span>

            <h1 className="font-display mt-5 text-4xl font-extrabold leading-[1.08] tracking-[-0.045em] text-slate-950 sm:text-5xl lg:text-[3.45rem]">
              {title}
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              {description}
            </p>

            {actions ? (
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                {actions}
              </div>
            ) : null}
          </div>
        </RevealOnScroll>
      </PageContainer>
    </section>
  );
}
