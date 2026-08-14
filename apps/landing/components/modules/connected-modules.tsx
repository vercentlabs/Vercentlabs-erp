import Link from "next/link";
import type { ConnectedModuleRef, LandingModule } from "@vercentlabs/landing-content";
import { ModuleTag } from "@/components/ui/tag";
import { Text } from "@/components/ui/text";

export function ConnectedModules({ links, resolveModule }: { links: readonly ConnectedModuleRef[]; resolveModule: (key: string) => LandingModule | undefined }) {
  return (
    <div className="border-t border-(--color-border-strong)">
      {links.map((link, index) => {
        const linkedModule = resolveModule(link.moduleKey);
        if (!linkedModule) return null;
        return (
          <div key={link.moduleKey} className="grid grid-cols-[46px_1fr] gap-4 border-b border-(--color-border-default) py-5 sm:grid-cols-[70px_220px_1fr] sm:items-start">
            <span className="vl-index" style={{ color: linkedModule.accentColor.hex }}>{String(index + 1).padStart(2, "0")}</span>
            <Link href={`/modules/${linkedModule.key}`} prefetch={false}><ModuleTag name={linkedModule.name} accentColor={linkedModule.accentColor.hex} /></Link>
            <Text variant="bodySmall" className="col-start-2 max-w-[68ch] sm:col-start-3">{link.relationship}</Text>
          </div>
        );
      })}
    </div>
  );
}
