import type { Preview } from "@storybook/react-vite";
import { I18nProvider } from "react-aria-components";
import "./preview.css";

// Same rationale as apps/web/src/shared/providers/locale-provider.tsx: a
// fixed locale so date/number-formatted stories render identically
// regardless of the machine running Storybook.
const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "canvas",
      values: [{ name: "canvas", value: "#F5F6F8" }],
    },
    a11y: {
      test: "error",
    },
  },
  decorators: [
    (Story) => (
      <I18nProvider locale="en-US">
        <Story />
      </I18nProvider>
    ),
  ],
};

export default preview;
