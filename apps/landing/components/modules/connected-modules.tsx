import Link from "next/link";
import type { ConnectedModuleRef, LandingModule } from "@vercentlabs/landing-content";
import { InformationBand } from "@/components/ui/card";
import { ModuleTag } from "@/components/ui/tag";
import { Text } from "@/components/ui/text";

/**
 * Meaningful, module-specific relationship explanations — never a generic
 * "integrates with everything" statement (per the brief's explicit warning).
 */
export function ConnectedModules({ links, resolveModule }: { links: readonly ConnectedModuleRef[]; resolveModule: (key: string) => LandingModule | undefined }) {
  return (
    <div className="flex flex-col">
      {links.map((link) => {
        const linkedModule = resolveModule(link.moduleKey);
        if (!linkedModule) return null;
        return (
          <InformationBand key={link.moduleKey}>
            <Link href={`/modules/${linkedModule.key}`} prefetch={false} className="flex-none">
              <ModuleTag name={linkedModule.name} accentColor={linkedModule.accentColor.hex} />
            </Link>
            <Text variant="bodySmall" className="max-w-[60ch] sm:text-right">
              {link.relationship}
            </Text>
          </InformationBand>
        );
      })}
    </div>
  );
}
