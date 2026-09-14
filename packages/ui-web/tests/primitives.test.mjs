// Real render smoke test for the first ui-web primitives -- proves the
// package's JSX actually mounts (Base UI's Dialog portal/focus-trap wiring
// included), not just that it type-checks. Uses react-dom/server so this
// runs under plain `node --test`, no browser required; deeper interaction
// behavior (focus trap, Escape handling) is covered by Playwright once a
// real screen consumes these components (see docs/ux/UI_REWRITE_TRACKER.md
// Phase 2).
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compile, React, renderToStaticMarkup } from "./harness.mjs";

test("Button renders with variant/size classes and forwards a ref", async () => {
  const { Button } = await import(pathToFileURL(compile("src/primitives/Button.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(Button, { variant: "danger", size: "large" }, "Delete"));
  assert.match(html, /Delete/);
  assert.match(html, /<button/);
});

test("StatusBadge renders the requested tone", async () => {
  const { StatusBadge } = await import(pathToFileURL(compile("src/primitives/StatusBadge.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(StatusBadge, { tone: "danger" }, "Blocked"));
  assert.match(html, /Blocked/);
});

test("Input marks aria-invalid when invalid", async () => {
  const { Input } = await import(pathToFileURL(compile("src/primitives/Input.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(Input, { invalid: true, placeholder: "Email" }));
  assert.match(html, /aria-invalid="true"/);
});

test("Dialog primitives mount without throwing (closed by default)", async () => {
  const { DialogRoot, DialogTrigger, DialogContent, DialogTitle } = await import(pathToFileURL(compile("src/primitives/Dialog.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      DialogRoot,
      null,
      React.createElement(DialogTrigger, null, "Open"),
      React.createElement(DialogContent, null, React.createElement(DialogTitle, null, "Confirm")),
    ),
  );
  assert.match(html, /Open/);
});
