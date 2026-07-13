import type { Metadata } from "next";
import {
  ArrowRight,
  BarChart3,
  Check,
  GitBranch,
  Layers3,
  LockKeyhole,
  Network,
  Workflow,
} from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import SectionHeading from "@/components/marketing/section-heading";

export const metadata: Metadata = {
  title: "ERP Platform Features",
  description:
    "Explore the shared workflow, permission, reporting, audit, integration and multi-company capabilities behind all 12 Vercent ERP modules.",
  alternates: {
    canonical: "/features",
  },
};

const groups = [
  {
    icon: Layers3,
    title: "Connected master data",
    description:
      "Use consistent customers, suppliers, items, employees, companies and locations across modules.",
    items: [
      "Shared business records",
      "Controlled ownership",
      "Validation rules",
      "Cross-module context",
    ],
  },
  {
    icon: Workflow,
    title: "Workflows and approvals",
    description:
      "Route decisions, exceptions and repeatable work through explicit responsibility.",
    items: [
      "Approval policies",
      "Status transitions",
      "Escalation paths",
      "Notifications",
    ],
  },
  {
    icon: LockKeyhole,
    title: "Roles and organisation boundaries",
    description:
      "Apply access rules by company, location, team, role and business action.",
    items: [
      "Least-privilege access",
      "Company boundaries",
      "Sensitive fields",
      "Controlled administration",
    ],
  },
  {
    icon: GitBranch,
    title: "Audit and traceability",
    description:
      "Understand who created, changed, approved and completed meaningful business activity.",
    items: [
      "Record history",
      "Approval history",
      "Ownership changes",
      "Operational traceability",
    ],
  },
  {
    icon: BarChart3,
    title: "Dashboards and reporting",
    description:
      "Combine operational and financial context for role-based decisions.",
    items: [
      "Operational dashboards",
      "Financial reports",
      "Exception visibility",
      "Exportable analysis",
    ],
  },
  {
    icon: Network,
    title: "Integration foundation",
    description:
      "Connect approved systems through versioned contracts, events and controlled data exchange.",
    items: [
      "REST APIs",
      "Business-event webhooks",
      "Import and export",
      "Integration access scopes",
    ],
  },
];

export default function FeaturesPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Platform capabilities"
        title="One consistent foundation beneath every ERP module."
        description="Vercent ERP combines modular applications with shared data, workflow, permission, audit, reporting and integration capabilities."
        actions={
          <Link href="/modules" className="button-primary">
            Explore 12 modules
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />

      <section className="bg-white py-16 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="Shared capabilities"
            title="Avoid rebuilding the same control separately in every department."
            align="center"
          />

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => {
              const Icon = group.icon;

              return (
                <article
                  key={group.title}
                  className="rounded-3xl border border-slate-200 bg-white p-6"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-7 w-7 text-indigo-600"
                  />
                  <h2 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                    {group.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {group.description}
                  </p>
                  <ul className="mt-5 space-y-3">
                    {group.items.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-3 text-sm font-semibold text-slate-700"
                      >
                        <Check
                          aria-hidden="true"
                          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>

          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/contact" className="button-primary min-h-[52px]">
              Book a product demo
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link href="/comparison" className="button-secondary min-h-[52px]">
              Compare ERP approaches
            </Link>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
