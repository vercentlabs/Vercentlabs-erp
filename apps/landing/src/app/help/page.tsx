import { createPageMetadata } from "@/lib/metadata";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  HelpCircle,
  Mail,
  ShieldCheck,
} from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { siteConfig } from "@/lib/site-config";

export const metadata = createPageMetadata({
  title: "VercentLabs ERP Help",
  description:
    "Find product, implementation, security, module and contact guidance for VercentLabs ERP.",
  path: "/help",
});

const topics = [
  {
    icon: BookOpen,
    title: "Product understanding",
    description:
      "Review modules, workflows, industries and the platform architecture.",
    href: "/features",
    label: "Explore the product",
  },
  {
    icon: ShieldCheck,
    title: "Security questions",
    description: "Review the current security and governance principles.",
    href: "/security",
    label: "Security approach",
  },
  {
    icon: HelpCircle,
    title: "Implementation questions",
    description:
      "Understand discovery, validation, migration and phased adoption.",
    href: "/how-it-works",
    label: "Implementation approach",
  },
];

export default function HelpPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Help centre"
        title="Find the right product or implementation information."
        description="Formal product documentation and customer support service levels will be published when the production platform is ready. Current enquiries are handled directly by VercentLabs."
      />

      <section className="bg-white py-9 sm:py-16">
        <PageContainer>
          <div className="grid gap-4 md:grid-cols-3">
            {topics.map((topic) => {
              const Icon = topic.icon;

              return (
                <article
                  key={topic.title}
                  className="rounded-xl border border-slate-200 bg-white p-4 sm:rounded-2xl sm:p-6"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-6 w-6 text-indigo-600"
                  />

                  <h2 className="font-display mt-4 text-xl font-extrabold text-slate-950">
                    {topic.title}
                  </h2>

                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {topic.description}
                  </p>

                  <Link
                    href={topic.href}
                    className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-indigo-600"
                  >
                    {topic.label}
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </article>
              );
            })}
          </div>

          <div className="mt-7 rounded-2xl bg-slate-950 p-4 text-white sm:mt-10 sm:rounded-3xl sm:p-10">
            <Mail aria-hidden="true" className="h-8 w-8 text-indigo-300" />

            <h2 className="font-display mt-3.5 text-2xl font-extrabold sm:mt-5 sm:text-3xl">
              Need a direct answer?
            </h2>

            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Share the product, implementation, partnership or technical
              question with enough context for the team to respond usefully.
            </p>

            <a
              href={"mailto:" + siteConfig.email}
              className="button-primary mt-6"
            >
              Email {siteConfig.email}
            </a>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
