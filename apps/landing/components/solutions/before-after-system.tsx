import { Grid } from "@/components/layout/container";
import { Text } from "@/components/ui/text";

/** The solution page's before/after narrative — two plain panels, not a card-grid gimmick. */
export function BeforeAfterSystem({ before, after }: { before: string; after: string }) {
  return (
    <Grid columns={2} gap={6}>
      <div className="rounded-(--radius-panel) border border-(--color-border-default) p-6">
        <Text variant="eyebrow">Before</Text>
        <Text variant="body" className="mt-3">
          {before}
        </Text>
      </div>
      <div className="rounded-(--radius-panel) border border-(--color-border-brand) bg-(--color-bg-elevated) p-6">
        <Text variant="eyebrow">After</Text>
        <Text variant="body" className="mt-3">
          {after}
        </Text>
      </div>
    </Grid>
  );
}
