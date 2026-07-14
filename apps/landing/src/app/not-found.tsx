import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";

export default function NotFoundPage() {
  return (
    <MarketingShell>
      <section className="bg-white py-14 sm:py-32">
        <PageContainer>
          <div className="mx-auto max-w-xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <SearchX aria-hidden="true" className="h-7 w-7" />
            </div>

            <p className="mt-6 text-sm font-extrabold uppercase tracking-[0.18em] text-indigo-600">
              Error 404
            </p>

            <h1 className="font-display mt-2 text-3xl font-extrabold tracking-[-0.04em] text-slate-950 sm:mt-3 sm:text-4xl">
              This page could not be found.
            </h1>

            <p className="mt-5 text-base leading-8 text-slate-600">
              The address may be incorrect, or the page may have moved while the
              product website was being developed.
            </p>

            <Link href="/" className="button-primary mt-7">
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Return to homepage
            </Link>
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}
