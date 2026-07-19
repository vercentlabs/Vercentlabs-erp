import type { Metadata } from "next";
import { ArrowRight, Check, Minus, Sparkles } from "lucide-react";
import Link from "next/link";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import SectionHeading from "@/components/marketing/section-heading";

export const metadata: Metadata = {
  title: "ERP Comparison",
  description:
    "Compare spreadsheets and point tools, accounting-only systems, traditional legacy ERP and the connected modular VercentLabs ERP approach.",
  alternates: {
    canonical: "/comparison",
  },
};

const approaches = [
  {
    key: "fragmented",
    name: "Spreadsheets & point tools",
    summary:
      "Fast to start, but responsibility and data fragment as operations grow.",
  },
  {
    key: "accounting",
    name: "Accounting-only system",
    summary:
      "Useful financial control while many operating processes remain elsewhere.",
  },
  {
    key: "legacy",
    name: "Traditional legacy ERP",
    summary:
      "Broad centralisation with heavier change and specialist dependency.",
  },
  {
    key: "vercent",
    name: "VercentLabs ERP",
    summary:
      "A shared platform and released CRM early-access scope with a phased operational-module roadmap.",
  },
] as const;

const rows = [
  {
    topic: "Business data",
    fragmented: "Repeated across files and departmental tools",
    accounting: "Financial data is central; operating data remains separate",
    legacy: "Centralised in a large suite",
    vercent: "Shared foundation; additional modules are planned",
  },
  {
    topic: "Workflow",
    fragmented: "Messages, sheets and manual follow-up",
    accounting: "Finance-led flows with external operational steps",
    legacy: "Structured but often difficult to change",
    vercent: "Configurable end-to-end workflows and approvals",
  },
  {
    topic: "User experience",
    fragmented: "Familiar tools with inconsistent processes",
    accounting: "Focused on finance users",
    legacy: "Capability-rich with specialist navigation",
    vercent: "Role-focused interfaces on a consistent design system",
  },
  {
    topic: "Governance",
    fragmented: "Permissions and history vary by tool",
    accounting: "Strong financial controls",
    legacy: "Broad controls with complex administration",
    vercent: "Shared roles, approvals, boundaries and audit history",
  },
  {
    topic: "Reporting",
    fragmented: "Manual consolidation and delayed context",
    accounting: "Reliable books with limited operational visibility",
    legacy: "Central reporting with configuration dependency",
    vercent: "Connected operational and financial reporting",
  },
  {
    topic: "Implementation",
    fragmented: "Tool-by-tool adoption",
    accounting: "Focused financial setup",
    legacy: "Large replacement programme",
    vercent: "Phased rollout around complete business flows",
  },
  {
    topic: "Expansion",
    fragmented: "Add more applications and integrations",
    accounting: "Add extensions or separate operating tools",
    legacy: "Customise or add suite modules",
    vercent: "Add modules on the same data and control foundation",
  },
  {
    topic: "Best fit",
    fragmented: "Very small or temporary workflows",
    accounting: "Finance-first requirements",
    legacy: "Large established transformation programmes",
    vercent: "Growing organisations needing connected operations",
  },
];

const decisionGuide = [
  {
    title: "Stay with current tools",
    when: "The process is small, low-risk, clearly owned and does not require cross-team data or controls.",
  },
  {
    title: "Strengthen accounting first",
    when: "The immediate requirement is reliable books, tax, receivables, payables and financial reporting.",
  },
  {
    title: "Choose a connected ERP",
    when: "Commercial, supply-chain, production, service, project or people workflows must share records and responsibility.",
  },
];

const faqs = [
  {
    question: "Is this a comparison against specific ERP brands?",
    answer:
      "No. It compares broad operating approaches. Product selection should use verified requirements, demonstrations, references, technical review and the current commercial proposal for each shortlisted vendor.",
  },
  {
    question: "Can VercentLabs ERP replace every existing system immediately?",
    answer:
      "A phased rollout is usually safer. The implementation plan identifies which processes should move first, which systems should integrate temporarily and what can be retired after validation.",
  },
  {
    question: "What should we compare during a demonstration?",
    answer:
      "Use complete business scenarios, real roles, approvals, exceptions, reports, migration samples, integrations and security boundaries rather than evaluating isolated screens.",
  },
  {
    question: "How should total cost be compared?",
    answer:
      "Include software, implementation, migration, integrations, internal effort, training, support, change requests and the operational cost of maintaining disconnected systems.",
  },
];

export default function ComparisonPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="ERP approach comparison"
        title="Compare how the whole operating model works."
        description="A useful ERP decision considers data, workflows, governance, implementation, reporting, expansion and total cost—not only a checklist of screens."
        actions={
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link
              href="/contact"
              className="button-primary min-h-11 text-xs sm:min-h-[52px] sm:text-sm"
            >
              Book a comparison demo
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="button-secondary min-h-11 text-xs sm:min-h-[52px] sm:text-sm"
            >
              Review pricing
            </Link>
          </div>
        }
      />

      <section className="bg-white py-10 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="Four common approaches"
            title="Start with the operating problem you need to solve."
            description="Each approach can be appropriate in the right context. The differences become important as teams, controls and data dependencies grow."
            align="center"
          />

          <div className="mt-7 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            {approaches.map((approach, index) => (
              <article
                key={approach.key}
                className={
                  "rounded-xl border p-4 sm:rounded-2xl sm:p-6 " +
                  (approach.key === "vercent"
                    ? "border-indigo-300 bg-indigo-50 shadow-lg shadow-indigo-100"
                    : "border-slate-200 bg-slate-50")
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">
                    Approach {index + 1}
                  </p>
                  {approach.key === "vercent" ? (
                    <Sparkles
                      aria-hidden="true"
                      className="h-5 w-5 text-indigo-600"
                    />
                  ) : null}
                </div>
                <h2 className="font-display mt-3 text-base font-extrabold text-slate-950 sm:mt-4 sm:text-xl">
                  {approach.name}
                </h2>
                <p className="mt-2 text-xs leading-6 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
                  {approach.summary}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-7 sm:mt-10 lg:hidden">
            <h2 className="sr-only">Mobile comparison details</h2>
            <div className="space-y-3 sm:space-y-5">
              {rows.map((row) => (
                <article
                  key={row.topic}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white sm:rounded-2xl"
                >
                  <h3 className="bg-slate-950 px-4 py-3 font-display text-base font-extrabold text-white sm:px-5 sm:py-4 sm:text-lg">
                    {row.topic}
                  </h3>

                  <dl className="divide-y divide-slate-200">
                    {approaches.map((approach) => (
                      <div key={approach.key} className="p-3.5 sm:p-5">
                        <dt className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">
                          {approach.name}
                        </dt>
                        <dd
                          className={
                            "mt-1.5 text-xs leading-6 sm:mt-2 sm:text-sm sm:leading-7 " +
                            (approach.key === "vercent"
                              ? "font-semibold text-indigo-800"
                              : "text-slate-600")
                          }
                        >
                          {row[approach.key]}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
          </div>

          <div className="responsive-table-scroll mt-10 hidden overflow-x-auto rounded-2xl border border-slate-200 lg:block">
            <table className="w-full min-w-[1040px] table-fixed border-collapse text-left">
              <caption className="sr-only">
                Comparison of spreadsheets and point tools, accounting-only
                systems, traditional legacy ERP and VercentLabs ERP
              </caption>
              <thead className="bg-slate-950 text-white">
                <tr>
                  <th
                    scope="col"
                    className="w-[16%] p-5 text-sm font-extrabold"
                  >
                    Area
                  </th>
                  {approaches.map((approach) => (
                    <th
                      key={approach.key}
                      scope="col"
                      className="p-5 text-sm font-extrabold"
                    >
                      {approach.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.topic}
                    className="border-t border-slate-200 align-top"
                  >
                    <th
                      scope="row"
                      className="bg-slate-50 p-5 text-sm font-extrabold text-slate-950"
                    >
                      {row.topic}
                    </th>
                    <td className="p-5 text-sm leading-7 text-slate-600">
                      {row.fragmented}
                    </td>
                    <td className="p-5 text-sm leading-7 text-slate-600">
                      {row.accounting}
                    </td>
                    <td className="p-5 text-sm leading-7 text-slate-600">
                      {row.legacy}
                    </td>
                    <td className="bg-indigo-50/70 p-5 text-sm font-semibold leading-7 text-indigo-950">
                      {row.vercent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 text-sm leading-7 text-slate-500">
            This table describes broad patterns, not universal facts about every
            product in a category. Validate each shortlisted system against your
            actual requirements and current vendor documentation.
          </p>
        </PageContainer>
      </section>

      <section className="border-y border-slate-200 bg-slate-50 py-10 sm:py-20 lg:py-24">
        <PageContainer>
          <SectionHeading
            eyebrow="Decision guide"
            title="Choose the smallest operating model that solves the real problem."
            align="center"
          />

          <div className="mt-7 grid gap-3 sm:mt-10 sm:gap-5 lg:grid-cols-3">
            {decisionGuide.map((item, index) => (
              <article
                key={item.title}
                className="rounded-xl border border-slate-200 bg-white p-4 sm:rounded-2xl sm:p-6"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  {index === 2 ? (
                    <Check aria-hidden="true" className="h-5 w-5" />
                  ) : (
                    <Minus aria-hidden="true" className="h-5 w-5" />
                  )}
                </span>
                <h2 className="font-display mt-3.5 text-base font-extrabold text-slate-950 sm:mt-5 sm:text-xl">
                  {item.title}
                </h2>
                <p className="mt-2 text-xs leading-6 text-slate-600 sm:mt-3 sm:text-sm sm:leading-7">
                  {item.when}
                </p>
              </article>
            ))}
          </div>
        </PageContainer>
      </section>

      <section className="bg-white py-10 sm:py-20 lg:py-24">
        <PageContainer width="narrow">
          <SectionHeading
            eyebrow="Comparison FAQ"
            title="Questions to settle before selecting an ERP."
            align="center"
          />

          <div className="mt-7 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 sm:mt-10 sm:rounded-3xl sm:px-7">
            {faqs.map((faq, index) => (
              <details key={faq.question} open={index === 0}>
                <summary className="flex min-h-[52px] cursor-pointer list-none items-center py-3.5 pr-7 text-left text-sm font-extrabold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600 sm:min-h-[64px] sm:py-5 sm:pr-8 sm:text-base">
                  {faq.question}
                </summary>
                <p className="pb-4 text-xs leading-6 text-slate-600 sm:pb-6 sm:text-sm sm:leading-7">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>

          <div className="mt-6 flex flex-col justify-center gap-2.5 sm:mt-8 sm:flex-row sm:gap-3">
            <Link
              href="/contact"
              className="button-primary min-h-11 w-full text-xs sm:min-h-[52px] sm:w-auto sm:text-sm"
            >
              Compare using your workflow
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link
              href="/modules"
              className="button-secondary min-h-11 w-full text-xs sm:min-h-[52px] sm:w-auto sm:text-sm"
            >
              Explore all modules
            </Link>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
