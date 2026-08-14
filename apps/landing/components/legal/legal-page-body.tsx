import type { LegalPageContent } from "@vercentlabs/landing-content";
import { Container, Section } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TableOfContents } from "@/components/content/table-of-contents";

export function LegalPageBody({ content, documentCode = "LEGAL" }: { content: LegalPageContent; documentCode?: string }) {
  return (
    <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 24 }}>
      <Container>
        <Breadcrumbs trail={[{ name: content.title, path: content.slug }]} />
        <header className="mt-8 border-y border-(--color-border-strong) py-8 sm:py-10">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-end lg:gap-16">
            <div>
              <span className="vl-folio">POLICY REGISTER / {documentCode}</span>
              <Heading level="display" as="h1" className="mt-5 max-w-[12ch]">{content.title}</Heading>
            </div>
            <dl className="border-t border-(--color-border-default) text-sm">
              <div className="grid grid-cols-[110px_1fr] gap-3 border-b border-(--color-border-default) py-3"><dt className="text-(--color-text-muted)">Status</dt><dd className="font-medium text-(--color-text-primary)">Current</dd></div>
              <div className="grid grid-cols-[110px_1fr] gap-3 border-b border-(--color-border-default) py-3"><dt className="text-(--color-text-muted)">Reviewed</dt><dd className="font-medium text-(--color-text-primary)">{content.lastReviewedAt}</dd></div>
              <div className="grid grid-cols-[110px_1fr] gap-3 py-3"><dt className="text-(--color-text-muted)">Clauses</dt><dd className="font-medium text-(--color-text-primary)">{content.sections.length}</dd></div>
            </dl>
          </div>
        </header>

        <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[240px_minmax(0,760px)] lg:gap-16 xl:gap-24">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <span className="vl-index">DOCUMENT INDEX</span>
            <div className="mt-5"><TableOfContents entries={content.sections.map((section) => ({ id: section.id, label: section.heading }))} /></div>
          </aside>
          <article className="border-t border-(--color-border-strong)">
            {content.sections.map((section, index) => (
              <section key={section.id} id={section.id} className="scroll-mt-24 grid grid-cols-[3rem_minmax(0,1fr)] gap-5 border-b border-(--color-border-default) py-8 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-8">
                <span className="vl-index">§{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <Heading level="h2">{section.heading}</Heading>
                  <div className="mt-5 space-y-4">
                    {section.paragraphs.map((paragraph, paragraphIndex) => <Text key={paragraphIndex} variant="body">{paragraph}</Text>)}
                  </div>
                </div>
              </section>
            ))}
          </article>
        </div>
      </Container>
    </Section>
  );
}
