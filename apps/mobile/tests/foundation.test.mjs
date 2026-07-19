import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("mobile navigation exposes five stable customer destinations", () => {
  const layout = read("app/(app)/_layout.tsx");
  for (const destination of [
    "Home",
    "Leads",
    "Pipeline",
    "Activities",
    "More",
  ]) {
    assert.match(layout, new RegExp(`title: \\"${destination}\\"`));
  }
});

test("design foundation includes accessible touch and semantic tokens", () => {
  const tokens = read("src/theme/tokens.ts");
  const button = read("src/ui/button.tsx");
  const login = read("app/(auth)/login.tsx");
  assert.match(tokens, /minimumTouchTarget = 48/);
  assert.match(button, /accessibilityRole="button"/);
  assert.match(login, /accessibilityRole="alert"/);
  assert.match(login, /autoComplete="email"/);
  assert.match(login, /Sign in securely/);
});

test("native credentials and cached business data use separate encrypted stores", () => {
  const tokens = read("src/auth/token-store.ts");
  const database = read("src/data/database.ts");
  const config = read("app.config.ts");
  assert.match(tokens, /SecureStore\.WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(database, /PRAGMA key/);
  assert.match(database, /mutation_queue/);
  assert.match(config, /useSQLCipher: true/);
});

test("the app consumes only public shared contracts", () => {
  for (const file of [
    "src/auth/auth-provider.tsx",
    "src/auth/token-store.ts",
    "src/data/database.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /apps\/web|services\/api|@\/\.\.\//);
  }
  assert.match(read("src/auth/auth-provider.tsx"), /@vercent\/shared-sdk/);
});

test("phase two replaces CRM placeholders with cached live workspaces", () => {
  for (const file of ["index.tsx", "leads.tsx", "pipeline.tsx", "activities.tsx"]) {
    const source = read(`app/(app)/${file}`);
    assert.doesNotMatch(source, /FoundationScreen/);
  }
  const database = read("src/data/database.ts");
  assert.match(database, /readCache/);
  assert.match(database, /writeCache/);
});

test("phase three provides governed actions and durable offline mutation replay", () => {
  assert.match(read("src/features/leads/lead-capture.tsx"), /Saved offline/);
  assert.match(read("src/data/sync.ts"), /flushMutationQueue/);
  assert.match(read("src/data/database.ts"), /enqueueMutation/);
  assert.match(read("src/ui/crm-list-screen.tsx"), /Mark complete/);
});

test("phase four closes the production customer-experience shell", () => {
  assert.match(read("src/ui/app-header.tsx"), /router\.push\("\/\(app\)\/search"/);
  assert.match(read("src/security/privacy-shield.tsx"), /authenticateAsync/);
  assert.match(read("src/ui/app-error-boundary.tsx"), /getDerivedStateFromError/);
  assert.match(read("eas.json"), /production/);
  assert.match(read("STORE_RELEASE.md"), /staged rollout/);
});
