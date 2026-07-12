import { createPageMetadata } from "@/lib/metadata";
import Link from "next/link";
import {
  BarChart3,
  Building2,
  GitBranch,
  LockKeyhole,
  Network,
  Workflow,
} from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import SectionHeading from "@/components/marketing/section-heading";

export const metadata = createPageMetadata({
  title: "Connected ERP Platform Features",
  description:
    "Explore shared data, configurable workflows, role-based access, reporting and enterprise controls across Vercent ERP.",
  path: "/features",
});

const features = [
  {
    icon: Network,
    title: "Shared business data",
    description:
      "Connect customers, suppliers, products, employees, locations, accounts and transactions through governed records.",
  },
  {
    icon: Workflow,
    title: "Configurable operations",
    description:
      "Model approvals, responsibilities, exceptions and handoffs around the organisation's real processes.",
  },
  {
    icon: LockKeyhole,
    title: "Controlled access",
    description:
      "Apply role, company, location and responsibility boundaries throughout the platform.",
  },
  {
    icon: BarChart3,
    title: "Operational visibility",
    description:
      "Build dashboards and reports from connected operational and financial information.",
  },
  {
    icon: Building2,
    title: "Enterprise structures",
    description:
      "Represent multiple companies, locations, departments and shared-service teams.",
  },
  {
    icon: GitBranch,
    title: "End-to-end traceability",
    description:
      "Follow business activity across workflows rather than through disconnected departmental records.",
  },
];

export default function FeaturesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Product capabilities"
        title="An ERP foundation designed around connected enterprise operations."
        description="Vercent ERP brings workflows, data, controls and reporting together so departments can operate from shared business context."
        actions={
          <>
            <Link href="/modules" className="button-primary">
              Explore modules
            </Link>
            <Link href="/how-it-works" className="button-secondary">
              See how it works
            </Link>
          </>
        }
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <SectionHeading
            eyebrow="Platform capabilities"
            title="Build processes on one governed operating foundation."
            description="The platform capabilities support every module and end-to-end workflow."
            align="center"
          />

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;

              return (
                <article
                  key={feature.title}
                  className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                    <Icon aria-hidden="true" className="h-6 w-6" />
                  </div>

                  <h2 className="font-display mt-6 text-xl font-extrabold text-slate-950">
                    {feature.title}
                  </h2>

                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {feature.description}
                  </p>
                </article>
              );
            })}
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
