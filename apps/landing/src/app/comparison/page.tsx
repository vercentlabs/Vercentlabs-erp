import type { Metadata } from "next";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";

export const metadata: Metadata = {
  title: "ERP Approach Comparison",
  description:
    "Compare fragmented tools, rigid legacy systems and the connected modular approach planned for Vercent ERP.",
};

const rows = [
  {
    topic: "Business data",
    fragmented: "Repeated across departmental tools",
    legacy: "Centralised but often difficult to adapt",
    vercent: "Shared and governed across modular workflows",
  },
  {
    topic: "Workflow",
    fragmented: "Messages, spreadsheets and manual follow-up",
    legacy: "Fixed processes with costly changes",
    vercent: "Configurable approvals and responsibilities",
  },
  {
    topic: "Implementation",
    fragmented: "Incremental tool-by-tool adoption",
    legacy: "Large replacement programme",
    vercent: "Phased, process-led rollout",
  },
  {
    topic: "Reporting",
    fragmented: "Manual consolidation",
    legacy: "Central reports with specialist dependency",
    vercent: "Role-based operational and financial visibility",
  },
  {
    topic: "Expansion",
    fragmented: "More applications and integrations",
    legacy: "Additional customisation",
    vercent: "Additional modules on the shared platform",
  },
];

export default function ComparisonPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Operating model comparison"
        title="Move beyond disconnected tools without repeating the limitations of rigid legacy ERP."
        description="The appropriate ERP approach depends on the organisation, process complexity, controls, systems and implementation readiness."
      />

      <section className="bg-white py-20 sm:py-24">
        <PageContainer>
          <div className="overflow-x-auto rounded-3xl border border-slate-200">
            <table className="min-w-[900px] w-full border-collapse text-left">
              <thead className="bg-slate-950 text-white">
                <tr>
                  <th className="p-5 text-sm font-extrabold">Area</th>
                  <th className="p-5 text-sm font-extrabold">
                    Fragmented tools
                  </th>
                  <th className="p-5 text-sm font-extrabold">
                    Traditional legacy ERP
                  </th>
                  <th className="p-5 text-sm font-extrabold">
                    Vercent ERP approach
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.topic}
                    className="border-t border-slate-200 align-top"
                  >
                    <th className="bg-slate-50 p-5 text-sm font-extrabold text-slate-950">
                      {row.topic}
                    </th>
                    <td className="p-5 text-sm leading-7 text-slate-600">
                      {row.fragmented}
                    </td>
                    <td className="p-5 text-sm leading-7 text-slate-600">
                      {row.legacy}
                    </td>
                    <td className="bg-indigo-50/60 p-5 text-sm font-semibold leading-7 text-slate-800">
                      {row.vercent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 text-sm leading-7 text-slate-500">
            This comparison describes broad implementation patterns. It does not
            claim that every existing application or ERP system behaves in the
            same way.
          </p>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
