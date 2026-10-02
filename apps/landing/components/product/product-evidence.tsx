import type { ReactNode } from "react";
import { getApprovedScreenshot } from "@/lib/product/screenshots";
import { ProductScreenshot } from "@/components/product/product-frame";

/**
 * Product evidence slot: renders the real product screenshot when the
 * registry holds an approved, current capture for `screenshotId` (with its
 * registered caption), and the given fallback (a truthful diagram such as the
 * connected-ERP map) otherwise. Never renders an empty frame or a placeholder —
 * approving a capture in lib/product/screenshots.ts is the only change needed
 * to switch a slot over. Images load lazily unless `priority` is set.
 */
export function ProductEvidence({
  screenshotId,
  fallback,
  priority = false,
  moduleAccentColor,
  sizes,
  className,
}: {
  screenshotId: string | undefined;
  fallback: ReactNode;
  priority?: boolean;
  moduleAccentColor?: string;
  sizes?: string;
  className?: string;
}) {
  if (!screenshotId || !getApprovedScreenshot(screenshotId)) return <>{fallback}</>;
  return (
    <div className={className}>
      <ProductScreenshot id={screenshotId} moduleAccentColor={moduleAccentColor ?? "var(--vl-brand)"} priority={priority} sizes={sizes} />
    </div>
  );
}
