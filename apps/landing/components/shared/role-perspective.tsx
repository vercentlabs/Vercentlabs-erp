import type { BuyerRole } from "@vercentlabs/landing-content";
import { Grid } from "@/components/layout/container";
import { Text, Heading } from "@/components/ui/text";

/**
 * Buyer-role perspectives woven into industry/workflow pages, per Phase 5's
 * brief: "not necessarily new dedicated indexable pages." Shared across both
 * page types rather than two near-identical components.
 */
export function RolePerspective({ roles }: { roles: readonly BuyerRole[] }) {
  if (roles.length === 0) return null;
  return (
    <Grid columns={roles.length >= 3 ? 3 : 2} gap={6}>
      {roles.map((role) => (
        <div key={role.slug} className="rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-bg-elevated) p-5">
          <Heading level="h4">{role.title}</Heading>
          <Text variant="bodySmall" className="mt-2">
            {role.concernSummary}
          </Text>
          <Text variant="caption" className="mt-3 block border-t border-(--color-border-default) pt-3">
            {role.proofPoint}
          </Text>
        </div>
      ))}
    </Grid>
  );
}
