
import { createPageMetadata } from "@/lib/metadata";
import { Check } from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";

export const metadata = createPageMetadata({
  title: "About VercentLabs",
  description:
    "Learn how VercentLabs builds connected ERP software for complete business operations.",
  path: "/about",
});

const principles = [
  "Solve operating problems before adding software complexity",
  "Design complete workflows instead of isolated features",
  "Treat permissions, auditability and data governance as foundations",
  "Build modularly without creating disconnected products",
  "Publish only claims that can be supported with evidence",
  "Learn with real implementation partners and business users",
];

export default function AboutPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="About VercentLabs"
        title="Building an enterprise operating platform with Indian business reality in mind."
        description="VercentLabs LLP is developing Vercent ERP to help organisations replace disconnected operations with governed, connected and understandable business workflows."
      />

      <section className="bg-white py-14 sm:py-16">
        <PageContainer>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-indigo-600">
                Mission
              </p>

              <h2 className="font-display mt-4 text-3xl font-extrabold tracking-[-0.035em] text-slate-950">
                Make enterprise operations easier to understand, control and
                improve.
              </h2>

              <p className="mt-5 leading-8 text-slate-600">
                The product direction connects finance, commercial operations,
                supply chain, production, people, projects and reporting through
                one modular platform.
              </p>
            </div>

            <div className="space-y-3">
              {principles.map((principle) => (
                <div
                  key={principle}
                  className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                  />
                  <p className="text-sm font-semibold leading-7 text-slate-700">
                    {principle}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
