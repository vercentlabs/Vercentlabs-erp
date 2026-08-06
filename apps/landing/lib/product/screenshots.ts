export interface ProductScreenshot {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  module: string;
  workflow?: string;
  caption?: string;
  /** Only screenshots with this set to true may render on an indexable page. */
  approvedForMarketing: boolean;
}

/**
 * No product screenshots have been captured and approved yet — see
 * docs/landing-redesign/phase-2/product-visual-guidelines.md, "Known limitations."
 * This is the real, honest state, not an oversight: ProductScreenshot renders
 * nothing on public pages until entries are added here with
 * `approvedForMarketing: true` (per Evidence and Honesty Rules — no fabricated UI).
 */
export const APPROVED_SCREENSHOTS: readonly ProductScreenshot[] = Object.freeze([]);

export function getApprovedScreenshot(id: string): ProductScreenshot | null {
  const match = APPROVED_SCREENSHOTS.find((screenshot) => screenshot.id === id);
  return match && match.approvedForMarketing ? match : null;
}
