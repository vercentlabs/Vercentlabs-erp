import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  CheckCircle2,
  MapPinned,
  PackageCheck,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import LandingProductCanvas from "@/components/home/landing-product-canvas";
import Header from "@/components/layout/header";
import PageContainer from "@/components/layout/page-container";

const proofMetrics = [
  { label: "Released module", value: "1", icon: Boxes },
  { label: "Roadmap modules", value: "11", icon: PackageCheck },
  { label: "Control foundation", value: "Shared", icon: ShieldCheck },
];

const operatingProof = [
  "Lead, activity, opportunity and pipeline workflows",
  "Roles, permissions, approvals and audit history",
  "Company, branch and operating-context boundaries",
];

export default function HeroSection() {
  return (
    <div className="bg-white">
      <Header />

      <section id="platform-preview" className="landing-hero">
        <div className="landing-hero__grid-lines" aria-hidden="true" />
        <PageContainer className="relative z-10">
          <div className="grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16 lg:py-20 xl:gap-20 xl:py-24">
            <div className="max-w-2xl text-center lg:text-left">
              <div className="landing-release-pill">
                <BadgeCheck aria-hidden="true" className="h-4 w-4" />
                Released CRM early access
                <span aria-hidden="true" />
                Governed ERP foundation
              </div>

              <h1 className="landing-hero__title">
                Customer work moves faster when every handoff has an owner.
              </h1>

              <p className="landing-hero__description">
                VercentLabs ERP connects lead capture, qualification,
                opportunity progress, approvals and audit history in one
                disciplined CRM workspace—while eleven additional ERP modules
                remain clearly labelled roadmap scope.
              </p>

              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
                <Link
                  href="/contact"
                  className="button-primary min-h-[50px] w-full px-6 sm:w-auto"
                >
                  Book a personalised demo
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
                <Link
                  href="/product"
                  className="button-secondary min-h-[50px] w-full px-6 sm:w-auto"
                >
                  Explore released scope
                </Link>
              </div>

              <ul className="mx-auto mt-8 grid max-w-xl gap-3 text-left lg:mx-0">
                {operatingProof.map((item) => (
                  <li key={item} className="landing-proof-line">
                    <CheckCircle2
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-teal-600"
                    />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-9 grid grid-cols-3 gap-2 border-t border-slate-200 pt-6 sm:gap-4">
                {proofMetrics.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="min-w-0 text-left">
                      <div className="flex items-center gap-2 text-indigo-600">
                        <Icon aria-hidden="true" className="h-4 w-4" />
                        <strong className="font-display text-base font-extrabold text-slate-950 sm:text-xl">
                          {item.value}
                        </strong>
                      </div>
                      <p className="mt-1 text-[9px] font-bold leading-4 text-slate-500 sm:text-[11px]">
                        {item.label}
                      </p>
                    </div>
                  );
                })}
              </div>

              <p className="mt-6 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:justify-start">
                <MapPinned aria-hidden="true" className="h-3.5 w-3.5" />
                Designed in India for governed business operations
              </p>
            </div>

            <div className="landing-hero__canvas-wrap">
              <LandingProductCanvas />
            </div>
          </div>
        </PageContainer>
      </section>
    </div>
  );
}
