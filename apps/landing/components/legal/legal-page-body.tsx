import type { LegalPageContent } from "@vercentlabs/landing-content";
import { Container, Section, Stack, SidebarLayout } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TableOfContents } from "@/components/content/table-of-contents";

/**
 * Deliberately plain — no CTAs, no FAQ accordion, no related-content rail.
 * A legal document isn't a conversion surface; it shouldn't read like one.
 */
export function LegalPageBody({ content }: { content: LegalPageContent }) {
  return (
    <Section tone="page" paddingTop={{ base: 10 }} paddingBottom={{ base: 24 }}>
      <Container>
        <Breadcrumbs trail={[{ name: content.title, path: content.slug }]} />
        <Stack gap={2} className="mt-6 max-w-[70ch]">
          <Heading level="display" as="h1">
            {content.title}
          </Heading>
          <Text variant="caption">Last reviewed: {content.lastReviewedAt}</Text>
        </Stack>

        <div className="mt-10">
          <SidebarLayout
            content={
              <Stack gap={10} className="max-w-[70ch]">
                {content.sections.map((section) => (
                  <div key={section.id} id={section.id} className="scroll-mt-24 flex flex-col gap-3">
                    <Heading level="h2">{section.heading}</Heading>
                    {section.paragraphs.map((paragraph, index) => (
                      <Text key={index} variant="body">
                        {paragraph}
                      </Text>
                    ))}
                  </div>
                ))}
              </Stack>
            }
            sidebar={
              <div className="sticky top-24">
                <TableOfContents entries={content.sections.map((section) => ({ id: section.id, label: section.heading }))} />
              </div>
            }
          />
        </div>
      </Container>
    </Section>
  );
}
