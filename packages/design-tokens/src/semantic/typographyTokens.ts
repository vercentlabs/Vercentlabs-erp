import { fontSize } from "../primitives/typography.ts";

/**
 * ERP-specific type scale. Named by role, not by size, so usage stays
 * meaningful ("use `sectionHeading`", not "use `text-lg`... or was it xl?").
 */
export const typography = {
  /** Metadata, timestamps, field labels. */
  meta: { size: fontSize.xs, lineHeight: 1.25 },
  /** Dense tables, secondary operational text. */
  dense: { size: fontSize.sm, lineHeight: 1.25 },
  /** Default ERP body text. */
  body: { size: fontSize.md, lineHeight: 1.5 },
  /** Emphasized body / form section labels. */
  emphasized: { size: fontSize.lg, lineHeight: 1.5 },
  /** Small section heading (card/panel titles). */
  sectionHeading: { size: fontSize.section, lineHeight: 1.25 },
  /** Standard page title, lower end of the 20-24px range. */
  pageTitleCompact: { size: fontSize.xl, lineHeight: 1.25 },
  /** Standard page title, upper end of the 20-24px range. */
  pageTitle: { size: fontSize["2xl"], lineHeight: 1.25 },
  /** Rare major workspace title. Use sparingly. */
  workspaceTitle: { size: fontSize["3xl"], lineHeight: 1.25 },
} as const;

/** Apply to any numeric column (currency, quantity, percentage, dates where
 * alignment matters) so digits line up across rows. */
export const tabularNumbers = { fontVariantNumeric: "tabular-nums" } as const;
