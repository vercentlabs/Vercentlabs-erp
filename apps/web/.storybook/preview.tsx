import type { Preview } from "@storybook/nextjs";

import "../src/shared/design/tokens.css";
import "../src/app/tailwind-theme.css";

// Deliberately does NOT import globals.css/navigation-v2.css/
// workspace-redesign-v3.css/enterprise-modules.css/operator-workbench.css
// -- those are the legacy, pre-rewrite global stylesheets
// (docs/ux/UI_REWRITE_TRACKER.md's "Legacy CSS/tokens remaining" list).
// Storybook is the contract for the NEW design system
// (packages/ui-web + the --erp-* tokens + Tailwind v4), so it must NOT
// silently inherit legacy global selectors that could make a component
// look "correct" in Storybook only because of page-level CSS a real
// consumer wouldn't have. If a story looks wrong here, the component
// itself is wrong -- that is the point.
//
// Known gap, not fixed by this file (see UI_REWRITE_TRACKER.md): the
// production app has no real font-loading setup today (no next/font, no
// @font-face) -- --erp-font-sans is a font-stack string ("Inter,
// ui-sans-serif, system-ui, ...") that silently falls back past Inter on
// any machine that doesn't happen to have it installed. Storybook
// therefore renders with the same fallback font production actually
// renders with today, which is the honest thing to mirror rather than
// making Storybook look better than the real product.

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // Fail the story test, not just warn, on a real WCAG violation --
      // SP032's own normative text is explicit that accessibility is a
      // non-negotiable acceptance contract, not a lint suggestion.
      test: "error",
    },
    backgrounds: {
      default: "canvas",
      values: [{ name: "canvas", value: "var(--erp-color-canvas)" }],
    },
  },
};

export default preview;
