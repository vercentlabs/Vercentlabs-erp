import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Text } from "@/components/ui/text";

export function ProductEvidenceSection({
  moduleName,
  accentColor,
  capabilityGroupCount,
  workflowName,
  connectedModuleCount,
  featuredOutcome,
}: {
  moduleName: string;
  accentColor: string;
  capabilityGroupCount: number;
  workflowName: string;
  connectedModuleCount: number;
  featuredOutcome?: { title: string; description: string };
}) {
  const register = [
    { label: "Capability architecture", value: `${capabilityGroupCount} groups`, detail: "Grouped by how the module is actually structured." },
    { label: "Primary operating sequence", value: workflowName, detail: "Rendered above as an ordered process rather than a feature collage." },
    { label: "Connected system", value: `${connectedModuleCount} modules`, detail: "Adjacent modules are linked through the operating model on this page." },
  ];

  return (
    <Section tone="page">
      <Container>
        <SectionHeader eyebrow="Operational proof" title={`${moduleName}, documented as an operating system.`} />
        <div className="mt-10 border-y border-(--color-border-strong)">
          {register.map((item, index) => (
            <div key={item.label} className="grid gap-3 border-b border-(--color-border-default) py-5 last:border-b-0 md:grid-cols-[3rem_minmax(180px,.55fr)_minmax(0,1fr)] md:items-start md:gap-6">
              <span className="vl-index" style={{ color: accentColor }}>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <Text variant="dataLabel">{item.label}</Text>
                <p className="mt-2 text-sm font-semibold text-(--color-text-primary)">{item.value}</p>
              </div>
              <Text variant="bodySmall">{item.detail}</Text>
            </div>
          ))}
          {featuredOutcome ? (
            <div className="grid gap-3 py-6 md:grid-cols-[3rem_minmax(180px,.55fr)_minmax(0,1fr)] md:items-start md:gap-6">
              <span className="vl-index" style={{ color: accentColor }}>04</span>
              <div>
                <Text variant="dataLabel">Business outcome</Text>
                <p className="mt-2 text-sm font-semibold text-(--color-text-primary)">{featuredOutcome.title}</p>
              </div>
              <Text variant="body">{featuredOutcome.description}</Text>
            </div>
          ) : null}
        </div>
      </Container>
    </Section>
  );
}
