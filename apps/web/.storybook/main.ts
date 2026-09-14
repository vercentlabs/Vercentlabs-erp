import type { StorybookConfig } from "@storybook/nextjs";

// Storybook consumes the REAL production styling pipeline -- the same
// Next.js app, the same Tailwind v4 theme bridge, the same --erp-* tokens
// -- rather than an isolated demo shell with its own copy of the design
// system. Per docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md,
// this is the design-system contract, not a disconnected showcase.
const config: StorybookConfig = {
  stories: ["../../../packages/ui-web/src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: {
    name: "@storybook/nextjs",
    options: {},
  },
  // apps/web has no public/ directory today (no static assets are served
  // that way) -- nothing to point staticDirs at yet.
  typescript: {
    reactDocgen: "react-docgen-typescript",
  },
};

export default config;
