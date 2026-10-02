import { Suspense } from "react";
import { CTAS } from "@vercentlabs/landing-content";
import { Container, Section } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ButtonLink } from "@/components/ui/button";
import { buildPageMetadata } from "@/lib/metadata";
import { ThankYouEffects } from "./thank-you-effects";

export const metadata = buildPageMetadata({ title: "Request received", description: "Your request to talk to an ERP specialist has been received.", path: "/book-demo/thank-you", index: false });
export default function ThankYouPage() {
  return <Section tone="page" className="flex min-h-[calc(100vh-4rem)] items-center" paddingTop={{ base: 10 }} paddingBottom={{ base: 10 }}><Container>
    <div className="mx-auto max-w-[920px] border-y border-(--color-border-strong) py-8 sm:py-12">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-16">
        <div><span className="vl-folio">SESSION REQUEST</span><p className="mt-6 tabular-data text-6xl font-semibold tracking-[-0.06em] text-(--color-text-brand)">✓</p><Text variant="caption" className="mt-3">Status / received</Text></div>
        <div className="reveal-on-load">
          <Heading level="display" id="thank-you-heading" tabIndex={-1}>Request received.</Heading>
          <Text variant="lead" className="mt-5 max-w-[58ch]" role="status">Thanks — an ERP specialist will review your request and reach out to arrange a conversation. In the meantime, feel free to explore the ERP.</Text>
          <Suspense fallback={null}><ThankYouEffects /></Suspense>
          <div className="mt-9 grid grid-cols-1 border-y border-(--color-border-default) sm:grid-cols-3">
            {[["01","Review","We read the operating context you submitted."],["02","Prepare","We focus the conversation on the relevant modules."],["03","Schedule","A specialist reaches out to arrange a time to talk."]].map(([n,t,d]) => <div key={n} className="border-b border-(--color-border-default) py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:px-5 sm:first:pl-0 sm:last:border-r-0"><span className="vl-index">{n}</span><p className="mt-3 text-sm font-semibold text-(--color-text-primary)">{t}</p><p className="mt-1 text-xs leading-relaxed text-(--color-text-secondary)">{d}</p></div>)}
          </div>
          <div className="mt-8 flex flex-wrap gap-3"><ButtonLink href="/" prefetch>Back to homepage</ButtonLink><ButtonLink href={CTAS.primary.href} variant="secondary" prefetch={false}>{CTAS.primary.label}</ButtonLink></div>
        </div>
      </div>
    </div>
  </Container></Section>;
}
