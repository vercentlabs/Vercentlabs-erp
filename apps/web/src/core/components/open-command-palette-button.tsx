"use client";

import AppIcon from "@/shared/components/app-icon";

export default function OpenCommandPaletteButton() {
  return (
    <button
      type="button"
      className="primary-button dashboard-search-action"
      onClick={() => {
        window.dispatchEvent(new Event("vercentlabs:open-command-palette"));
      }}
    >
      <AppIcon name="search" size={17} />
      Find anything
      <kbd aria-hidden="true">Ctrl K</kbd>
    </button>
  );
}
