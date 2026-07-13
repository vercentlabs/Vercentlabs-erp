import {
  ArrowRight,
  Building2,
  Check,
  ClipboardCheck,
  Search,
  Users,
} from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "ERP Design Partner Programme",
  description:
    "Apply to work with VercentLabs on real ERP workflows, validation and phased implementation for a growing Indian business.",
  path: "/customers",
});

const stages = [
  {
    icon: Search,
    title: "Fit review",
    description:
      "Confirm the organisation, process owners, current systems and a clearly owned operating problem.",
  },
  {
    icon: Users,
    title: "Workflow discovery",
    description:
      "Map users, decisions, handoffs, controls, exceptions, reports and data sources.",
  },
  {
    icon: ClipboardCheck,
    title: "Scenario validation",
    description:
      "Review realistic process scenarios and validate terminology, roles and expected outcomes.",
  },
  {
    icon: Building2,
    title: "Pilot decision",
    description:
      "Agree whether a controlled pilot, implementation partnership or later follow-up is appropriate.",
  },
];

const fitSignals = [
  "A growing manufacturer, distributor or service business in India",
  "Important workflows split across spreadsheets or disconnected applications",
  "A named process owner who can explain decisions and exceptions",
  "Willingness to validate realistic scenarios and implementation priorities",
  "A practical first scope rather than an immediate whole-company replacement",
];

export default function CustomersPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Design partner programme"
        title="Shape the ERP workflows your business will depend on."
        description="Selected organisations work directly with VercentLabs to turn real operating problems into validated workflows, controls and a practical first implementation scope."
        actions={
          <Link href="/signup" className="button-primary">
            Apply for the programme
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="grid gap-4 lg:grid-cols-4">
            {stages.map((stage, index) => {
              const Icon = stage.icon;
              return (
                <article
                  key={stage.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <Icon
                      aria-hidden="true"
                      className="h-6 w-6 text-indigo-600"
                    />
                    <span className="text-xs font-extrabold text-slate-400">
                      0{index + 1}
                    </span>
                  </div>
                  <h2 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                    {stage.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {stage.description}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-10 grid gap-8 rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-teal-50 p-7 sm:p-10 lg:grid-cols-2">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-600">
                Good programme fit
              </p>
              <h2 className="font-display mt-3 text-3xl font-extrabold text-slate-950">
                Start with a real operating constraint.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                The strongest applications describe a specific process, the
                people involved, the current tools and the business consequence
                of leaving it fragmented.
              </p>
            </div>
            <ul className="space-y-3">
              {fitSignals.map((signal) => (
                <li
                  key={signal}
                  className="flex items-start gap-3 rounded-2xl bg-white/85 p-4 text-sm font-semibold leading-6 text-slate-700"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                  />
                  {signal}
                </li>
              ))}
            </ul>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
