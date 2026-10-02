import Link from "next/link";
import { getLandingModule, type LandingModule } from "@vercentlabs/landing-content";

/**
 * A module and the modules it hands work to, as stated in its content
 * (connectedModules). The current module is emphasised on the left; each
 * connection is a real link with its relationship written out, so nothing
 * depends on the connector lines.
 */
export function ConnectedModules({ landingModule }: { landingModule: LandingModule }) {
  const connections = landingModule.connectedModules
    .map((link) => ({ link, target: getLandingModule(link.moduleKey) }))
    .filter((entry): entry is { link: (typeof landingModule.connectedModules)[number]; target: LandingModule } => entry.target !== null);
  if (!connections.length) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,0.35fr)_minmax(0,1fr)]">
      <div className="border-t-[3px] bg-(--vl-paper-strong) p-5 lg:border-r lg:border-r-(--color-border-strong)" style={{ borderTopColor: landingModule.accentColor.hex }}>
        <span className="vl-index">This module</span>
        <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-(--color-text-primary)">{landingModule.displayName}</p>
        <p className="mt-2 text-sm leading-[1.55] text-(--color-text-secondary)">{landingModule.purpose}</p>
      </div>
      <ul className="border-t border-(--color-border-strong)">
        {connections.map(({ link, target }) => (
          <li key={target.key} className="border-b border-(--color-border-default)">
            <Link href={`/modules/${target.key}`} prefetch={false} className="group grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 px-1 py-4 sm:grid-cols-[1.5rem_11rem_minmax(0,1fr)] sm:items-baseline sm:px-4">
              <span className="text-(--color-text-muted)" aria-hidden="true">→</span>
              <span className="flex items-center gap-2 text-[0.95rem] font-semibold text-(--color-text-primary) group-hover:text-(--color-text-brand)">
                <span className="h-2 w-2 shrink-0" style={{ backgroundColor: target.accentColor.hex }} aria-hidden="true" />
                {target.displayName}
              </span>
              <span className="col-start-2 mt-1 text-sm leading-[1.6] text-(--color-text-secondary) sm:col-start-3 sm:mt-0">{link.relationship}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
