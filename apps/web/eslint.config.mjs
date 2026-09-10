import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    // Gitignored local Playwright output (see .gitignore) — ESLint has no
    // built-in awareness of .gitignore, so without this, a local E2E run
    // leaves behind minified trace/report bundles that eslint then tries
    // to lint as source, producing thousands of unrelated false failures.
    "playwright-report/**",
    "test-results/**",
  ]),
]);
