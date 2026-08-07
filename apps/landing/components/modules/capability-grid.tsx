import type { CapabilityGroup } from "@vercentlabs/landing-content";
import { InformationBand } from "@/components/ui/card";
import { Text, Heading } from "@/components/ui/text";
import { Stack } from "@/components/layout/container";

/**
 * Full-width information bands, not an accordion of hundreds of
 * uncontextualised bullets — every capability stays in server-rendered HTML
 * (progressive disclosure isn't used here since the content is short enough
 * per group to just show).
 */
export function CapabilityGrid({ groups }: { groups: readonly CapabilityGroup[] }) {
  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <InformationBand key={group.id} className="sm:flex-col sm:items-start">
          <Stack gap={3}>
            <div>
              <Heading level="h3">{group.name}</Heading>
              <Text variant="bodySmall" className="mt-1.5 max-w-[70ch]">
                {group.description}
              </Text>
            </div>
            <ul className="flex flex-col gap-1.5">
              {group.capabilities.map((capability) => (
                <li key={capability} className="flex items-start gap-2 text-sm text-(--color-text-primary)">
                  <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-(--color-text-brand)" aria-hidden="true" />
                  {capability}
                </li>
              ))}
            </ul>
          </Stack>
        </InformationBand>
      ))}
    </div>
  );
}
