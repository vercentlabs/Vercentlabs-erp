import { createPageMetadata } from "@/lib/metadata";
import { Activity, Check, Clock, Wrench } from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";

export const metadata = createPageMetadata({
  title: "VercentLabs ERP Status",
  description:
    "Review the operational status of VercentLabs ERP services and the public website.",
  path: "/status",
});

const services = [
  {
    icon: Check,
    title: "Public landing application",
    status: "Operational",
    description:
      "The public product, module, industry and company pages are available.",
  },
  {
    icon: Wrench,
    title: "VercentLabs ERP product",
    status: "Active development",
    description:
      "Core platform, API, tenant, database and ERP module work is continuing.",
  },
  {
    icon: Clock,
    title: "Production customer service",
    status: "Not publicly launched",
    description:
      "No public production uptime or service-level commitment is currently claimed.",
  },
];

export default function StatusPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Status"
        title="Publish the real development state without invented uptime."
        description="This status page distinguishes the public website from the ERP product and any future customer production services."
      />

      <section className="bg-white py-9 sm:py-16">
        <PageContainer>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:gap-3 sm:rounded-2xl sm:p-5">
            <Activity aria-hidden="true" className="h-6 w-6 text-emerald-700" />

            <div>
              <p className="font-display font-extrabold text-emerald-950">
                Public status information is available.
              </p>

              <p className="mt-1 text-sm text-emerald-800">
                This is a development-status summary, not a contractual
                service-level dashboard.
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {services.map((service) => {
              const Icon = service.icon;

              return (
                <article
                  key={service.title}
                  className="rounded-xl border border-slate-200 bg-white p-4 sm:rounded-2xl sm:p-6"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-6 w-6 text-indigo-600"
                  />

                  <h2 className="font-display mt-4 text-xl font-extrabold text-slate-950">
                    {service.title}
                  </h2>

                  <p className="mt-3 inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-extrabold text-indigo-700">
                    {service.status}
                  </p>

                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    {service.description}
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
