import { Container } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ButtonLink } from "@/components/ui/button";
import { CTAS } from "@vercentlabs/landing-content";

export default function NotFound() {
  return (
    <Container className="flex min-h-[60vh] flex-col items-start justify-center py-24">
      <Text variant="eyebrow">404</Text>
      <Heading level="h1" className="mt-3">
        We couldn&apos;t find that page.
      </Heading>
      <Text variant="lead" className="mt-4 max-w-[52ch]">
        This section of the site is still being built out. Head back to the homepage, or book a demo and we&apos;ll
        walk you through it directly.
      </Text>
      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/">Back to homepage</ButtonLink>
        <ButtonLink href={CTAS.primary.href} variant="secondary">
          {CTAS.primary.label}
        </ButtonLink>
      </div>
    </Container>
  );
}
