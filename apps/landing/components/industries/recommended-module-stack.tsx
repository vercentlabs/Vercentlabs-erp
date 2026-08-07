import Link from "next/link";
import type { LandingModule } from "@vercentlabs/landing-content";
import { Stack } from "@/components/layout/container";
import { InformationBand } from "@/components/ui/card";
import { Text, Heading } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";

interface StackEntry {
  moduleKey: string;
  role: string;
}

/** The industry page's "which modules and why" section — full-width rows, not a card grid (Control Surface). */
export function RecommendedModuleStack({
  entries,
  resolveModule,
}: {
  entries: readonly StackEntry[];
  resolveModule: (key: string) => LandingModule | undefined;
}) {
  return (
    <Stack gap={0}>
      {entries.map((entry) => {
        const landingModule = resolveModule(entry.moduleKey);
        if (!landingModule) return null;
        return (
          <InformationBand key={entry.moduleKey}>
            <Link href={`/modules/${landingModule.key}`} prefetch={false} className="flex-none">
              <ModuleTag name={landingModule.name} accentColor={landingModule.accentColor.hex} />
            </Link>
            <div className="sm:max-w-[640px]">
              <Heading level="h4">{landingModule.name}</Heading>
              <Text variant="bodySmall" className="mt-1">
                {entry.role}
              </Text>
            </div>
          </InformationBand>
        );
      })}
    </Stack>
  );
}
