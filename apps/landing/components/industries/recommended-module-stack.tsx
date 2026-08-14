import Link from "next/link";
import type { LandingModule } from "@vercentlabs/landing-content";
import { Text, Heading } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";

interface StackEntry { moduleKey: string; role: string; }

export function RecommendedModuleStack({ entries, resolveModule }: { entries: readonly StackEntry[]; resolveModule: (key: string) => LandingModule | undefined }) {
  return (
    <div className="border-t border-(--color-border-strong)">
      {entries.map((entry, index) => {
        const landingModule = resolveModule(entry.moduleKey);
        if (!landingModule) return null;
        return (
          <div key={entry.moduleKey} className="grid grid-cols-[48px_1fr] gap-4 border-b border-(--color-border-default) py-6 sm:grid-cols-[70px_220px_1fr] lg:grid-cols-[90px_280px_1fr] lg:py-7">
            <span className="vl-index" style={{ color: landingModule.accentColor.hex }}>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <Link href={`/modules/${landingModule.key}`} prefetch={false}><ModuleTag name={landingModule.name} accentColor={landingModule.accentColor.hex} /></Link>
              <Heading level="h3" className="mt-3">{landingModule.name}</Heading>
            </div>
            <Text variant="bodySmall" className="col-start-2 max-w-[70ch] sm:col-start-3">{entry.role}</Text>
          </div>
        );
      })}
    </div>
  );
}
