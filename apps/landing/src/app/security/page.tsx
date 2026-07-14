import { ArrowRight, Database, Eye, KeyRound, ShieldCheck } from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "ERP Security and Governance",
  description:
    "Review the security architecture priorities for VercentLabs ERP, including tenant isolation, role-based access, auditability and secure delivery.",
  path: "/security",
});

const foundations = [
  {
    icon: Database,
    title: "Tenant and organisation boundaries",
    description:
      "Keep customer, company and location data inside explicit application and database scopes.",
  },
  {
    icon: KeyRound,
    title: "Least-privilege access",
    description:
      "Grant users and integrations only the roles, records and actions required for their responsibilities.",
  },
  {
    icon: Eye,
    title: "Traceable business activity",
    description:
      "Preserve meaningful approval, administrative and transaction history for review and investigation.",
  },
  {
    icon: ShieldCheck,
    title: "Secure delivery lifecycle",
    description:
      "Use reviewed changes, dependency controls, environment separation, backups and incident procedures before production operation.",
  },
];

export default function SecurityPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Security and governance"
        title="Build control into the ERP architecture—not around it later."
        description="VercentLabs ERP is being designed around tenant isolation, least privilege, approval authority, traceability and secure operational practices. Specific assurances will be published only after implementation and verification."
        actions={
          <Link href="/contact" className="button-primary">
            Discuss security requirements
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        }
      />

      <section className="bg-white py-9 sm:py-16">
        <PageContainer>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {foundations.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-2xl sm:p-6"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-6 w-6 text-indigo-600"
                  />
                  <h2 className="font-display mt-5 text-xl font-extrabold text-slate-950">
                    {item.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {item.description}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-7 grid gap-5 rounded-2xl bg-slate-950 p-4 text-white sm:mt-10 sm:gap-8 sm:rounded-3xl sm:p-10 lg:grid-cols-2">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-300">
                Evidence before assurance
              </p>
              <h2 className="font-display mt-2 text-2xl font-extrabold sm:mt-3 sm:text-3xl">
                Security claims must follow verification.
              </h2>
            </div>
            <div className="space-y-4 text-sm leading-7 text-slate-300">
              <p>
                Architecture descriptions explain the intended control model;
                they are not a substitute for production testing, operating
                evidence or a signed customer agreement.
              </p>
              <p>
                Before processing production customer data, VercentLabs must
                complete environment hardening, access reviews, backup and
                recovery testing, logging, vulnerability management and
                incident-response preparation.
              </p>
            </div>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
