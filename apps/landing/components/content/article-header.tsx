import { Container, Section, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ContentFreshnessMeta } from "@/components/content/content-freshness";
import type { ContentAuthor, ContentFreshness } from "@vercentlabs/landing-content";

/**
 * The header for every long-form resource page — eyebrow category, H1, dek,
 * and a truthful author/freshness byline (never omitted for a "substantial"
 * resource, per docs/landing-redesign/phase-6/author-and-review-policy.md).
 */
export function ArticleHeader({
  eyebrow,
  title,
  dek,
  author,
  freshness,
}: {
  eyebrow: string;
  title: string;
  dek: string;
  author: ContentAuthor;
  freshness: ContentFreshness;
}) {
  return (
    <Section tone="page" className="pb-0 pt-8 sm:pt-10">
      <Container>
        <Stack gap={5} className="max-w-[780px]">
          <Text variant="eyebrow">{eyebrow}</Text>
          <Heading level="display" as="h1">
            {title}
          </Heading>
          <Text variant="lead">{dek}</Text>
          <ContentFreshnessMeta author={author} freshness={freshness} />
        </Stack>
      </Container>
    </Section>
  );
}
