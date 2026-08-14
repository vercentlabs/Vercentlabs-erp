import type { CapabilityGroup } from "@vercentlabs/landing-content";
import { Text, Heading } from "@/components/ui/text";

export function CapabilityGrid({ groups }: { groups: readonly CapabilityGroup[] }) {
  return (
    <div className="border-t border-(--color-border-strong)">
      {groups.map((group, groupIndex) => (
        <section key={group.id} className="grid grid-cols-[48px_1fr] gap-4 border-b border-(--color-border-default) py-6 sm:grid-cols-[70px_260px_1fr] lg:grid-cols-[90px_320px_1fr] lg:py-8">
          <span className="vl-index text-(--color-text-brand)">{String(groupIndex + 1).padStart(2, "0")}</span>
          <div>
            <Heading level="h3">{group.name}</Heading>
            <Text variant="bodySmall" className="mt-2 max-w-[34ch]">{group.description}</Text>
          </div>
          <ol className="col-start-2 mt-5 border-t border-(--color-border-default) sm:col-start-3 sm:mt-0">
            {group.capabilities.map((capability, index) => (
              <li key={capability} className="grid grid-cols-[2rem_1fr] gap-3 border-b border-(--color-border-default) py-2.5 text-sm text-(--color-text-primary) last:border-b-0">
                <span className="vl-index">{String(index + 1).padStart(2, "0")}</span>
                <span>{capability}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
