import type { ReactNode } from "react";

import PageContainer from "@/components/layout/page-container";

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
    <section className="relative overflow-hidden bg-slate-950 py-20 text-white sm:py-24">
      <div
        aria-hidden="true"
        className="absolute -left-32 top-0 h-80 w-80 rounded-full bg-indigo-600/25 blur-[110px]"
      />
      <div
        aria-hidden="true"
        className="absolute -right-32 bottom-0 h-80 w-80 rounded-full bg-teal-500/20 blur-[110px]"
      />

      <PageContainer className="relative">
        <div className="max-w-3xl">
          <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-indigo-300">
            {eyebrow}
          </p>

          <h1 className="font-display mt-5 text-4xl font-extrabold leading-tight tracking-[-0.04em] sm:text-5xl lg:text-6xl">
            {title}
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
            {description}
          </p>

          {actions ? (
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {actions}
            </div>
          ) : null}
        </div>
      </PageContainer>
    </section>
  );
}
