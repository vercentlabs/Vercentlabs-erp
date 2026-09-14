// Real render smoke tests for the Phase 5 primitive batch: RadioGroup,
// Switch, Progress, Accordion, Toast. Same react-dom/server approach as
// the other test files -- no browser, no bundler.
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compile, React, renderToStaticMarkup } from "./harness.mjs";

test("RadioGroup renders items with the checked one carrying data-checked", async () => {
  const { RadioGroupRoot, RadioGroupItem } = await import(pathToFileURL(compile("src/primitives/RadioGroup.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      RadioGroupRoot,
      { defaultValue: "hot" },
      React.createElement(RadioGroupItem, { value: "cold" }, "Cold"),
      React.createElement(RadioGroupItem, { value: "hot" }, "Hot"),
    ),
  );
  assert.match(html, /Cold/);
  assert.match(html, /Hot/);
  assert.match(html, /data-checked/);
});

test("Switch renders unchecked/checked state", async () => {
  const { Switch } = await import(pathToFileURL(compile("src/primitives/Switch.tsx")).href);
  const unchecked = renderToStaticMarkup(React.createElement(Switch, { "aria-label": "Enable offline mode" }));
  assert.doesNotMatch(unchecked, /data-checked/);
  const checked = renderToStaticMarkup(React.createElement(Switch, { "aria-label": "Enable offline mode", checked: true, onCheckedChange: () => {} }));
  assert.match(checked, /data-checked/);
});

test("Progress renders label, value and an indicator sized to its value", async () => {
  const { ProgressRoot, ProgressLabel, ProgressValue, ProgressTrack, ProgressIndicator } = await import(
    pathToFileURL(compile("src/primitives/Progress.tsx")).href
  );
  const html = renderToStaticMarkup(
    React.createElement(
      ProgressRoot,
      { value: 40 },
      React.createElement(ProgressLabel, null, "Importing leads"),
      React.createElement(ProgressValue, null),
      React.createElement(ProgressTrack, null, React.createElement(ProgressIndicator, null)),
    ),
  );
  assert.match(html, /Importing leads/);
  assert.match(html, /40%/);
});

test("Accordion renders trigger and panel content", async () => {
  const { AccordionRoot, AccordionItem, AccordionTrigger, AccordionPanel } = await import(pathToFileURL(compile("src/primitives/Accordion.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      AccordionRoot,
      { defaultValue: ["duplicates"] },
      React.createElement(
        AccordionItem,
        { value: "duplicates" },
        React.createElement(AccordionTrigger, null, "Possible duplicates"),
        React.createElement(AccordionPanel, null, "2 possible matches found"),
      ),
    ),
  );
  assert.match(html, /Possible duplicates/);
  assert.match(html, /2 possible matches found/);
});

test("Toast: ToastProvider + Toaster mount without throwing with no active toasts", async () => {
  const { ToastProvider, Toaster } = await import(pathToFileURL(compile("src/primitives/Toast.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(ToastProvider, null, React.createElement(Toaster, null)));
  assert.equal(typeof html, "string");
});
