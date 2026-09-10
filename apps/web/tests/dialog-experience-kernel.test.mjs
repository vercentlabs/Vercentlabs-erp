// CRM vNext Prompt 2 — the canonical Dialog/ConfirmDialog Experience
// Kernel primitive (apps/web/src/shared/design/dialog.tsx), addressing
// CRM-VNEXT-021 ("Calls/Meetings dialog focus behavior needs canonical
// shared implementation").
//
// dialog.tsx is a "use client" component that renders JSX and imports a
// CSS Module — neither is executable by plain Node (JSX needs a build
// transform Node's native TS type-stripping does not perform; CSS imports
// have no Node loader), so real DOM/focus-trap behavior cannot be
// exercised without a browser test runner, which this repository does not
// currently provide for apps/web (only apps/landing has a Playwright
// config — confirmed by inspecting the repo before writing this file).
// This follows the same structural/source verification convention already
// established for exactly this class of code, e.g.
// apps/web/tests/crm-lead-timeline-f019.test.mjs. It asserts on the exact
// mechanisms (event listeners, refs, aria attributes, cleanup logic) that
// implement each required behavior, not just that some button exists.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const dialog = read("src/shared/design/dialog.tsx");

test("Dialog: renders proper modal dialog semantics", () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby=\{titleId\}/);
  assert.match(dialog, /aria-describedby=\{description \? descriptionId : undefined\}/);
});

test("Dialog: moves initial focus to the heading on open", () => {
  assert.match(dialog, /headingRef\.current\?\.focus\(\);/);
  assert.match(dialog, /<h2 ref=\{headingRef\}/);
});

test("Dialog: traps Tab/Shift+Tab focus within the dialog's focusable controls", () => {
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /event\.shiftKey/);
  assert.match(dialog, /querySelectorAll<HTMLElement>/);
  assert.match(dialog, /last\.focus\(\)/);
  assert.match(dialog, /first\.focus\(\)/);
});

test("Dialog: closes on Escape only when dismissal is allowed, and does not close a still-open nested dialog's parent", () => {
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /if \(canDismissRef\.current\) onCloseRef\.current\(\);/);
  assert.match(dialog, /querySelector\(`\.\$\{styles\.dialog\}`\)\) return;/);
});

test("Dialog: restores focus to the previously-focused element and background scroll/inert state on close", () => {
  assert.match(dialog, /const previouslyFocused = document\.activeElement as HTMLElement \| null;/);
  assert.match(dialog, /previouslyFocused\?\.focus\(\);/);
  assert.match(dialog, /document\.body\.style\.overflow = previousOverflow;/);
  assert.match(dialog, /element\.inert = inert;/);
});

test("Dialog: hides the rest of the page from assistive technology while open (background inert + aria-hidden)", () => {
  assert.match(dialog, /element\.inert = true;/);
  assert.match(dialog, /element\.setAttribute\("aria-hidden", "true"\);/);
});

test("Dialog: exposes a labeled close button and supports a mobile full-height drawer-end variant", () => {
  assert.match(dialog, /aria-label=\{typeof title === "string" \? `Close \$\{title\}` : "Close dialog"\}/);
  assert.match(dialog, /DialogVariant = "centered" \| "drawer-end"/);
  const css = read("src/shared/design/dialog.module.css");
  assert.match(css, /\.variant_drawer-end \{/);
  assert.match(css, /\.variant_centered \{/);
});

test("ConfirmDialog: composes Dialog with cancel/confirm actions and a busy state that blocks dismissal", () => {
  assert.match(dialog, /export function ConfirmDialog/);
  assert.match(dialog, /canDismiss=\{!busy\}/);
  assert.match(dialog, /onClick=\{onConfirm\}/);
  assert.match(dialog, /\{busy \? "Working…" : confirmLabel\}/);
});

test("Dialog is exported from the shared design system's public entry point", () => {
  const index = read("src/shared/design/index.ts");
  assert.match(index, /export \{ Dialog, ConfirmDialog, type DialogVariant \} from "\.\/dialog";/);
});

test("Dialog CSS module uses canonical --erp-* tokens for its backdrop and shadow (no hard-coded color literals)", () => {
  const css = read("src/shared/design/dialog.module.css");
  assert.match(css, /background: var\(--erp-color-overlay-backdrop\);/);
  assert.match(css, /box-shadow: var\(--erp-shadow-overlay\);/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no hex color literals");
  assert.doesNotMatch(css, /rgba?\(/, "no raw rgb()/rgba() color literals — must consume a token instead");
});

test("Calls workspace: the completion and history dialogs now use the shared Dialog primitive instead of a hand-rolled backdrop+section pair", () => {
  const source = read("src/modules/crm/components/calls-workspace.tsx");
  assert.match(source, /import \{[\s\S]{0,200}Dialog,[\s\S]{0,200}\} from "@\/shared\/design";/);
  assert.match(source, /\{completion \? \(\s*<Dialog/);
  assert.match(source, /\{eventsFor \? \(\s*<Dialog/);
});

test("Calls workspace: the customer-inappropriate 'Immutable evidence' governance label was removed from the Call history dialog", () => {
  const source = read("src/modules/crm/components/calls-workspace.tsx");
  assert.doesNotMatch(source, /Immutable evidence/);
});

// Prompt 6 closeout: CRM-VNEXT-072 required migrating Calls' main
// schedule/log/edit editor dialog and every Meetings dialog off the
// pre-existing hand-rolled backdrop+role="dialog" pattern; CRM-VNEXT-071
// required replacing the Prompt-6-owned confirm() cancel prompts in both
// files with the canonical ConfirmDialog. Both are closed as of Prompt 6 —
// see CRM_VNEXT_IMPLEMENTATION_REGISTER.md.
test("Calls workspace: the main Call editor dialog and the Cancel confirmation now use the shared Dialog/ConfirmDialog primitives (CRM-VNEXT-072/071 closed)", () => {
  const source = read("src/modules/crm/components/calls-workspace.tsx");
  assert.doesNotMatch(source, /crm-call-dialog-backdrop/);
  assert.match(source, /import \{[\s\S]{0,200}ConfirmDialog,[\s\S]{0,200}\} from "@\/shared\/design";/);
  assert.match(source, /\{editor \? \(\s*<Dialog/);
  assert.match(source, /\{cancelTarget \? \(\s*<ConfirmDialog/);
  assert.doesNotMatch(source, /!confirm\(/);
});

test("Meetings workspace: every dialog (editor, completion, cancel, history) now uses the shared Dialog/ConfirmDialog primitives (CRM-VNEXT-072/071 closed)", () => {
  const source = read("src/modules/crm/components/meetings-workspace.tsx");
  assert.doesNotMatch(source, /crm-meeting-dialog-backdrop/);
  assert.match(source, /import \{[\s\S]{0,200}ConfirmDialog,[\s\S]{0,200}Dialog,[\s\S]{0,200}\} from "@\/shared\/design";/);
  assert.match(source, /\{editor \? \(\s*<Dialog/);
  assert.match(source, /\{completion \? \(\s*<Dialog/);
  assert.match(source, /\{cancelTarget \? \(\s*<ConfirmDialog/);
  assert.match(source, /\{eventsFor \? \(\s*<Dialog/);
  assert.doesNotMatch(source, /!confirm\(/);
});

test("CRM customer-facing surfaces touched this prompt no longer contain literal feature-ID labels", () => {
  for (const path of [
    "src/modules/crm/components/calls-workspace.tsx",
    "src/modules/crm/components/meetings-workspace.tsx",
    "src/modules/crm/components/sales-stages-workspace.tsx",
    "src/modules/crm/components/lead-detail-workspace.tsx",
    "src/app/(app)/crm/settings/page.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /F0\d\d\s*[·:]/, `${path} must not display a literal feature ID to customers`);
  }
});
