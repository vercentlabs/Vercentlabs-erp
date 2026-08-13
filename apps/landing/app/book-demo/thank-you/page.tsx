import { Suspense } from "react";
import { Container, Section, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ButtonLink } from "@/components/ui/button";
import { buildPageMetadata } from "@/lib/metadata";
import { ThankYouEffects } from "./thank-you-effects";

export const metadata = buildPageMetadata({
  title: "Request received",
  description: "Your demo request has been received.",
  path: "/book-demo/thank-you",
  index: false,
});

export default function ThankYouPage() {
  return (
    <Section tone="page" paddingTop={{ base: 14, sm: 20 }} className="flex min-h-[calc(100vh-4rem)] flex-col justify-center">
      <Container>
        <div className="reveal-on-load mx-auto max-w-[560px] text-center">
          {/*
            The confirmation itself is server-rendered and visible immediately —
            it must never depend on client hydration completing first. Only the
            requestId-dependent side effects (focus, analytics dedup) need the
            client, and produce no visible output, so they're isolated in their
            own Suspense boundary that can never blank out real content.
          */}
          <Heading level="display" id="thank-you-heading" tabIndex={-1}>
            Request received.
          </Heading>
          <Text variant="lead" className="mt-4" role="status">
            Thanks — a specialist will review your request and reach out to schedule your demo. In the meantime,
            feel free to explore the platform.
          </Text>
          <Suspense fallback={null}>
            <ThankYouEffects />
          </Suspense>
          <Inline gap={3} className="mt-8 justify-center">
            <ButtonLink href="/" prefetch>
              Back to homepage
            </ButtonLink>
            <ButtonLink href="/product" variant="secondary" prefetch={false}>
              Explore the platform
            </ButtonLink>
          </Inline>
        </div>
      </Container>
    </Section>
  );
}
