import type { Metadata } from "next";
import {
  Check,
  Eye,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import SectionHeading from "@/components/marketing/section-heading";

export const metadata: Metadata = {
  title: "Security and Governance",
  description:
    "Review the identity, permission, audit and operational governance principles planned for Vercent ERP.",
};

const principles = [
  {
    icon: UserRoundCheck,
    title: "Identity and responsibility",
    description:
      "Associate access and business actions with identifiable users and organisational roles.",
  },
  {
    icon: KeyRound,
    title: "Role-based permissions",
    description:
      "Control capabilities through role, company, location and responsibility boundaries.",
  },
  {
    icon: Eye,
    title: "Traceable activity",
    description:
      "Retain business and administrative history required for operational review.",
  },
  {
    icon: LockKeyhole,
    title: "Controlled administration",
    description:
      "Separate administrative responsibilities and control sensitive configuration changes.",
  },
];

export default function SecurityPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Security and governance"
        title="Enterprise control must begin at the platform foundation."
        description="The security model is designed around identity, least-privilege access, organisation boundaries, approval authority and traceable changes."
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <SectionHeading
            eyebrow="Security principles"
            title="Make access, responsibility and change visible."
            description="Specific infrastructure controls and formal certifications must only be published after implementation and independent verification."
            align="center"
          />

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {principles.map((principle) => {
              const Icon = principle.icon;

              return (
                <article
                  key={principle.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-7 w-7 text-indigo-600"
                  />

                  <h2 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                    {principle.title}
                  </h2>

                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {principle.description}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-10 rounded-3xl bg-slate-950 p-8 text-white sm:p-12">
            <div className="flex items-center gap-3">
              <ShieldCheck
                aria-hidden="true"
                className="h-8 w-8 text-indigo-300"
              />
              <h2 className="font-display text-2xl font-extrabold">
                Publication rule
              </h2>
            </div>

            <div className="mt-7 grid gap-3 md:grid-cols-2">
              {[
                "Do not claim certifications before formal assessment",
                "Do not publish availability guarantees before service readiness",
                "Document implemented controls with evidence",
                "Review security as architecture and operations evolve",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-4"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300"
                  />
                  <p className="text-sm leading-7 text-slate-300">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
