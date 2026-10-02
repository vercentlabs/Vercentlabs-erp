import { CTAS, LAUNCH_CAPABILITY_COUNTS, MODULE_NAV_GROUPS, getRoutedWorkflowsForModule } from "@vercentlabs/landing-content";
import type { LandingModule } from "@vercentlabs/landing-content";
import { Container, Section } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { CtaPair } from "@/components/conversion/cta-pair";

/**
 * What is this module for? Name, one-line purpose, definition, derived facts,
 * and an exploration-first action pair: the module's main workflow (or the
 * module map) first, an ERP specialist second.
 */
export function ModuleHero({ landingModule }: { landingModule: LandingModule }) {
  const group = MODULE_NAV_GROUPS.find((candidate) => candidate.key === landingModule.navGroup);
  const mainWorkflow = getRoutedWorkflowsForModule(landingModule.key)[0];
  const explore = mainWorkflow
    ? { href: `/workflows/${mainWorkflow.slug}`, label: `See the ${mainWorkflow.name} workflow` }
    : { href: "/modules", label: "Explore all modules" };
  const facts = [
    { value: String(LAUNCH_CAPABILITY_COUNTS[landingModule.key]), label: "approved capabilities" },
    { value: String(landingModule.capabilityGroups.length), label: "capability groups" },
    { value: String(landingModule.connectedModules.length), label: "connected modules" },
  ];

  return (
    <Section tone="page" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 10, sm: 12 }}>
      <Container>
        <div className="reveal-on-load grid grid-cols-1 gap-10 border-t-[3px] pt-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.6fr)] lg:items-end lg:gap-16" style={{ borderTopColor: landingModule.accentColor.hex }}>
          <div>
            <Text variant="eyebrow">{group ? `${group.label} module` : "Module"}</Text>
            <Heading level="h1" className="mt-5">
              {landingModule.displayName}
            </Heading>
            <p className="mt-5 max-w-[34ch] text-xl font-semibold leading-snug tracking-[-0.025em] text-(--color-text-primary) sm:text-2xl">{landingModule.purpose}</p>
            <Text variant="bodySmall" className="mt-4 max-w-[68ch]">
              {landingModule.directDefinition}
            </Text>
            <CtaPair
              className="mt-7"
              ctaLocation={`module_hero_${landingModule.key}`}
              primary={{ href: explore.href, event: "module_related_link_click", label: explore.label }}
              secondary={{ href: `/book-demo?module=${landingModule.key}`, event: "module_hero_cta_click", label: CTAS.talkToSpecialist.label, variant: "secondary" }}
            />
          </div>

          <dl className="grid grid-cols-3 border-t border-(--color-border-strong) lg:grid-cols-1">
            {facts.map((fact) => (
              <div key={fact.label} className="grid content-start border-b border-(--color-border-default) py-3 pr-3 lg:grid-cols-[4.5rem_1fr] lg:items-baseline lg:pr-0">
                <dt className="mt-1 text-[0.78rem] leading-snug text-(--color-text-secondary) sm:text-sm lg:mt-0">{fact.label}</dt>
                <dd className="tabular-data -order-1 text-2xl font-semibold leading-none tracking-[-0.05em] text-(--color-text-primary) sm:text-[1.75rem]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </Section>
  );
}
