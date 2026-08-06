import {
  COLOR_TOKENS,
  SEMANTIC_STATE,
  LANDING_MODULES,
  LANDING_WORKFLOWS,
} from "@vercentlabs/landing-content";
import { Container, Section, Stack, Inline, Grid, Divider, SectionHeader } from "@/components/layout/container";
import { Heading, Text, InlineCode, Prose } from "@/components/ui/text";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card, BorderedPanel, InformationBand, FeatureList, Checklist, Metric } from "@/components/ui/card";
import { Tag, ModuleTag } from "@/components/ui/tag";
import { FieldWrapper, FormAlert } from "@/components/forms/field";
import { Input, Textarea, Select, Checkbox, RadioGroup } from "@/components/forms/inputs";
import { ProductScreenshot, ProductCallout, WorkflowConnector } from "@/components/product/product-frame";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "Design System Review",
  description: "Internal, non-public review environment for the Control Surface component library.",
  path: "/design-system",
  index: false,
});

const swatches: Array<[string, string]> = Object.entries(COLOR_TOKENS);
const stateSwatches: Array<[string, string]> = Object.entries(SEMANTIC_STATE).filter(([key]) => !key.endsWith("Soft"));

export default function DesignSystemPage() {
  return (
    <Container className="py-16">
      <div className="mb-10 rounded-(--radius-control) border border-(--color-state-warning) bg-(--color-state-warning-soft) px-4 py-3 text-sm text-(--color-state-warning)">
        Internal review route — not indexed, not linked from public navigation. Not for customer viewing.
      </div>

      <Heading level="display">Control Surface — Design System</Heading>
      <Text variant="lead" className="mt-3 max-w-[70ch]">
        Every reusable primitive shipped in Phase 2, in every state it supports. See{" "}
        <InlineCode>docs/landing-redesign/phase-2/component-inventory.md</InlineCode> for the full written spec.
      </Text>

      {/* Colour */}
      <Section tone="page" className="!py-12">
        <SectionHeader eyebrow="Foundations" title="Colour tokens" />
        <Grid columns={4} gap={4} className="mt-6">
          {swatches.map(([name, value]) => (
            <div key={name} className="rounded-(--radius-card) border border-(--color-border-default) p-3">
              <div className="h-14 rounded-(--radius-control)" style={{ backgroundColor: value }} />
              <Text variant="caption" className="mt-2">
                {name}
              </Text>
              <Text variant="caption">{value}</Text>
            </div>
          ))}
        </Grid>

        <Text variant="label" className="mt-8 block">
          State colours
        </Text>
        <Grid columns={4} gap={4} className="mt-3">
          {stateSwatches.map(([name, value]) => (
            <div key={name} className="rounded-(--radius-card) border border-(--color-border-default) p-3">
              <div className="h-10 rounded-(--radius-control)" style={{ backgroundColor: value }} />
              <Text variant="caption" className="mt-2">
                {name}
              </Text>
            </div>
          ))}
        </Grid>

        <Text variant="label" className="mt-8 block">
          Module accents (4 sourced from the real product, 8 landing-original — see modules.js)
        </Text>
        <Inline gap={2} className="mt-3">
          {LANDING_MODULES.map((module) => (
            <ModuleTag key={module.key} name={`${module.name}${module.accentColor.sourcedFromProduct ? "" : " *"}`} accentColor={module.accentColor.hex} />
          ))}
        </Inline>
        <Text variant="caption" className="mt-2">
          * landing-original colour — not sourced from apps/web&apos;s CSS. See creative-direction.md.
        </Text>
      </Section>

      <Divider />

      {/* Typography */}
      <Section tone="page" className="!py-12">
        <SectionHeader eyebrow="Foundations" title="Typography" />
        <Stack gap={4} className="mt-6">
          <Heading level="display">Display heading</Heading>
          <Heading level="h1">Heading 1</Heading>
          <Heading level="h2">Heading 2</Heading>
          <Heading level="h3">Heading 3</Heading>
          <Heading level="h4">Heading 4</Heading>
          <Text variant="lead">Lead paragraph — used directly under a hero or section headline.</Text>
          <Text variant="bodyLarge">Body large — for emphasis paragraphs.</Text>
          <Text variant="body">Body — the default paragraph style for most page copy.</Text>
          <Text variant="bodySmall">Body small — secondary or supporting detail.</Text>
          <Text variant="label">Label text</Text>
          <Text variant="eyebrow">Eyebrow label</Text>
          <Text variant="caption">Caption text, for image captions and fine print.</Text>
          <Text variant="dataValue" className="tabular-data">
            1,039
          </Text>
          <Text variant="dataLabel">Data label</Text>
          <Text variant="body">
            Inline code looks like <InlineCode>getLandingModule(&quot;crm&quot;)</InlineCode>.
          </Text>
        </Stack>
        <Prose className="mt-8">
          <p>
            Prose blocks apply consistent spacing to long-form copy: paragraphs, nested headings, and lists all get
            sensible rhythm without per-page CSS.
          </p>
          <h2>A nested heading</h2>
          <p>Body copy continues here with a comfortable reading measure capped at 70 characters.</p>
          <ul>
            <li>First point</li>
            <li>Second point</li>
          </ul>
        </Prose>
      </Section>

      <Divider />

      {/* Buttons */}
      <Section tone="page" className="!py-12">
        <SectionHeader eyebrow="Actions" title="Buttons and links" />
        <Stack gap={4} className="mt-6">
          <Inline gap={3}>
            <Button variant="primary">Primary button</Button>
            <Button variant="secondary">Secondary button</Button>
            <Button variant="tertiary">Tertiary button</Button>
            <Button variant="primary" loading>
              Loading
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </Inline>
          <Inline gap={3} className="rounded-(--radius-panel) bg-(--color-bg-inverse) p-4">
            <Button variant="inverse">Inverse button</Button>
          </Inline>
          <Inline gap={3}>
            <ButtonLink href="/book-demo">Book a Demo (link)</ButtonLink>
            <IconButton label="Close">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </IconButton>
          </Inline>
        </Stack>
      </Section>

      <Divider />

      {/* Structure */}
      <Section tone="page" className="!py-12">
        <SectionHeader eyebrow="Structure" title="Cards, panels, tags, metrics" />
        <Grid columns={3} gap={6} className="mt-6">
          <Card accentColor={COLOR_TOKENS.brandAccent}>
            <Text variant="label">Card</Text>
            <Text variant="bodySmall" className="mt-2">
              For genuinely discrete, browsable items — not a default section wrapper.
            </Text>
          </Card>
          <BorderedPanel>
            <Text variant="label">Bordered panel</Text>
            <Text variant="bodySmall" className="mt-2">No shadow — structural grouping only.</Text>
          </BorderedPanel>
          <div>
            <Metric label="Modules" value="12" />
          </div>
        </Grid>

        <Stack gap={0} className="mt-8">
          <InformationBand>
            <Text variant="label">Information band item one</Text>
            <Text variant="bodySmall">A full-width row — the Control Surface alternative to a card grid.</Text>
          </InformationBand>
          <InformationBand>
            <Text variant="label">Information band item two</Text>
            <Text variant="bodySmall">Stacks on mobile, aligns on desktop.</Text>
          </InformationBand>
        </Stack>

        <Inline gap={2} className="mt-8">
          <Tag tone="neutral">Neutral</Tag>
          <Tag tone="brand">Brand</Tag>
          <Tag tone="success">Success</Tag>
          <Tag tone="warning">Warning</Tag>
          <Tag tone="error">Error</Tag>
          <Tag tone="info">Info</Tag>
        </Inline>

        <Grid columns={2} gap={6} className="mt-8">
          <FeatureList items={["Two- and three-way matching gates every AP posting", "Immutable, database-trigger-enforced audit trail"]} />
          <Checklist items={["Real screenshots only", "No fabricated statistics", "WCAG AA contrast checked"]} />
        </Grid>
      </Section>

      <Divider />

      {/* Forms */}
      <Section tone="page" className="!py-12">
        <SectionHeader eyebrow="Forms" title="Form primitives and states" />
        <Grid columns={2} gap={8} className="mt-6">
          <Stack gap={5}>
            <FieldWrapper id="ds-name" label="Full name" required>
              {(describedBy) => <Input id="ds-name" name="name" required autoComplete="name" aria-describedby={describedBy} />}
            </FieldWrapper>
            <FieldWrapper id="ds-email" label="Work email" required error="Enter a valid work email address.">
              {(describedBy) => (
                <Input id="ds-email" name="email" type="email" required autoComplete="email" invalid aria-describedby={describedBy} />
              )}
            </FieldWrapper>
            <FieldWrapper id="ds-message" label="What are you hoping to solve?" description="Optional, but helps us prepare for the call.">
              {(describedBy) => <Textarea id="ds-message" name="message" aria-describedby={describedBy} />}
            </FieldWrapper>
            <FieldWrapper id="ds-size" label="Company size">
              {(describedBy) => (
                <Select id="ds-size" name="size" defaultValue="" aria-describedby={describedBy}>
                  <option value="" disabled>
                    Select a range
                  </option>
                  <option value="11-50">11–50 employees</option>
                  <option value="51-200">51–200 employees</option>
                  <option value="201-500">201–500 employees</option>
                </Select>
              )}
            </FieldWrapper>
            <Checkbox id="ds-consent" label="I agree to be contacted about this demo request." required />
            <RadioGroup
              name="ds-interest"
              legend="Primary area of interest"
              options={[
                { id: "ds-r1", value: "manufacturing", label: "Manufacturing" },
                { id: "ds-r2", value: "distribution", label: "Distribution & retail" },
              ]}
            />
            <Button type="submit" disabled>
              Submit (disabled in this review environment)
            </Button>
          </Stack>
          <Stack gap={4}>
            <FormAlert tone="error">We couldn&apos;t submit the form — check the highlighted fields and try again.</FormAlert>
            <FormAlert tone="success">Thanks — we&apos;ll be in touch within one business day.</FormAlert>
            <FieldWrapper id="ds-disabled" label="Disabled field">
              {(describedBy) => <Input id="ds-disabled" disabled placeholder="Not editable" aria-describedby={describedBy} />}
            </FieldWrapper>
          </Stack>
        </Grid>
      </Section>

      <Divider />

      {/* Product presentation */}
      <Section tone="page" className="!py-12">
        <SectionHeader
          eyebrow="Product"
          title="Product screenshot framework"
          description="No screenshots are approved for marketing yet — the honest placeholder state below is what's shown here on purpose (see lib/product/screenshots.ts). It never renders on a public, indexable page."
        />
        <Grid columns={2} gap={6} className="mt-6">
          <ProductScreenshot id="crm-pipeline" moduleAccentColor={COLOR_TOKENS.brandAccent} allowPlaceholder />
          <div className="flex flex-col gap-3">
            <ProductCallout number={1} label="Lead captured from public form" />
            <ProductCallout number={2} label="Scored and SLA-tracked automatically" />
            <ProductCallout number={3} label="Converts to account + opportunity in one step" />
          </div>
        </Grid>

        <Text variant="label" className="mt-10 block">
          Workflow connector — {LANDING_WORKFLOWS[0].name}
        </Text>
        <WorkflowConnector
          className="mt-4"
          steps={LANDING_WORKFLOWS[0].modules.map((key) => {
            const moduleInfo = LANDING_MODULES.find((candidate) => candidate.key === key);
            return { label: moduleInfo?.name ?? key, accentColor: moduleInfo?.accentColor.hex ?? COLOR_TOKENS.brandAccent };
          })}
        />
      </Section>

      <Divider />

      {/* Navigation states */}
      <Section tone="page" className="!py-12">
        <SectionHeader eyebrow="Navigation" title="Breadcrumbs" />
        <div className="mt-6">
          <Breadcrumbs
            trail={[
              { name: "Modules", path: "/modules" },
              { name: "CRM", path: "/modules/crm" },
            ]}
          />
        </div>
        <Text variant="bodySmall" className="mt-4 max-w-[60ch]">
          The header mega menu, mobile navigation, and sticky header behaviour are best reviewed live at the top of
          this page and at every viewport width — they are not reproduced in isolation here since they depend on
          real scroll/viewport state.
        </Text>
      </Section>
    </Container>
  );
}
