// Loader for genuinely executing a "server-only" TS module (e.g.
// src/modules/crm/server/lead-detail-data.ts) for real behavioral test
// coverage, instead of only source-pattern-matching it.
//
// Two obstacles stand between a plain `import()` of such a file and a real
// test:
//   1. The `server-only` npm package's default export unconditionally
//      throws ("This module cannot be imported from a Client Component
//      module...") — it isn't a `typeof window` runtime guard, it's a
//      build-time marker meant to be caught by a bundler condition. Real
//      Server Components never actually execute that throw because Next's
//      bundler resolves the package's `react-server` conditional export
//      (a no-op) instead of its `default` export. Plain Node has no such
//      condition active, so a bare `import("server-only")` always throws.
//   2. TypeScript-style extension-less relative imports (`from
//      "./lead-owner-data"`) are valid under the repo's `moduleResolution:
//      "bundler"` tsconfig setting but are NOT valid for Node's own ESM
//      resolver, which requires explicit extensions.
//
// This loader installs a `module.registerHooks()` resolve hook (in-thread,
// synchronous — the non-deprecated successor to `module.register()`) that
// short-circuits `server-only` to an empty module and retries a failed
// extension-less relative specifier with `.ts` appended. It does not
// transpile anything — Node's own native TypeScript type-stripping handles
// the rest, so this only works for "erasable" TypeScript syntax (no enums,
// no parameter properties, no `namespace`), same as `node`'s built-in TS
// support in general. `@vercentlabs/*` workspace packages and any other
// bare npm specifier resolve completely normally through real node_modules
// resolution — nothing about those is mocked, so the target module's real
// cross-cutting collaborators (services/api's `getCrmRecord`,
// `getCrmOptions`, `findCrmDuplicates`, etc.) run for real, exactly as they
// would in production. Only the caller-supplied `client`/`context`/`id`
// inputs are test doubles.
//
// Unlike load-ts-module.mjs (which copies+rewrites files into a temp
// directory for @/-aliased modules), this loader imports the real source
// file in place, so it only works for a module whose imports are either
// bare npm/workspace specifiers or plain relative sibling imports — not
// `@/` aliases. `lead-detail-data.ts` and its one local dependency
// (`lead-owner-data.ts`) satisfy that.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export default {}",
          shortCircuit: true,
          format: "module",
        };
      }
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
          return nextResolve(`${specifier}.ts`, context);
        }
        throw error;
      }
    },
  });
}

const root = path.resolve(import.meta.dirname, "../../../..");

/** @param {string} relativePathFromRepoRoot e.g. "apps/web/src/modules/crm/server/lead-detail-data.ts" */
export async function loadServerTsModule(relativePathFromRepoRoot) {
  install();
  const absolute = path.join(root, relativePathFromRepoRoot);
  return import(pathToFileURL(absolute).href);
}
