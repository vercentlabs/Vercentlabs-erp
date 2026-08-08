"use client";

/**
 * Two real, REPRODUCED WebKit-specific gaps found via Phase 8's cross-browser
 * smoke suite (both pass on desktop-chromium/firefox, both failed on
 * desktop-webkit and mobile-webkit before these fixes):
 *
 * 1. WebKit's default keyboard-navigation mode does not include plain <a>
 *    links in the Tab order at all — only form controls/buttons (real Safari
 *    behavior: "Full Keyboard Access" is off by default, and only affects
 *    system-level Safari, not embedded WebKit test runs, which reproduce the
 *    same default). A debug trace confirmed Tab skipped straight past this
 *    link to the first actual <button> in the header. tabIndex={0} makes an
 *    element focusable regardless of its tag, overriding that default.
 * 2. Even once focused and activated, WebKit does not reliably move keyboard
 *    focus to a tabindex="-1" fragment target the way Chromium/Firefox do —
 *    explicitly focusing the target after the click makes this consistent
 *    across engines instead of depending on each browser's native handling.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="skip-link"
      tabIndex={0}
      onClick={() => {
        requestAnimationFrame(() => document.getElementById("main-content")?.focus());
      }}
    >
      Skip to main content
    </a>
  );
}
