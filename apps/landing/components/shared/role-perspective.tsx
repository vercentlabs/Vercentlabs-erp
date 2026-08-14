import type { BuyerRole } from "@vercentlabs/landing-content";
import { Text, Heading } from "@/components/ui/text";

export function RolePerspective({ roles }: { roles: readonly BuyerRole[] }) {
  if (roles.length === 0) return null;
  return (
    <div className="border-t border-(--color-border-strong)">
      {roles.map((role, index) => (
        <section key={role.slug} className="grid grid-cols-[44px_1fr] gap-4 border-b border-(--color-border-default) py-7 sm:grid-cols-[70px_minmax(180px,.55fr)_minmax(0,1fr)] sm:gap-6 lg:grid-cols-[90px_260px_minmax(0,1fr)_minmax(180px,.55fr)] lg:py-8">
          <span className="vl-index pt-1 text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
          <Heading level="h3">{role.title}</Heading>
          <Text variant="bodySmall" className="col-start-2 max-w-[62ch] sm:col-start-3">{role.concernSummary}</Text>
          <Text variant="caption" className="col-start-2 border-t border-(--color-border-default) pt-3 sm:col-start-3 lg:col-start-4 lg:border-t-0 lg:pt-1">{role.proofPoint}</Text>
        </section>
      ))}
    </div>
  );
}
