"use client";

import { useEffect } from "react";
import { Container } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Container className="flex min-h-[60vh] flex-col items-start justify-center py-24">
      <Text variant="eyebrow">Something went wrong</Text>
      <Heading level="h1" className="mt-3">
        This page hit an unexpected error.
      </Heading>
      <Text variant="lead" className="mt-4 max-w-[52ch]">
        Nothing on your end broke it — try again, or head back to the homepage.
      </Text>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="secondary" onClick={() => window.location.assign("/")}>
          Back to homepage
        </Button>
      </div>
    </Container>
  );
}
