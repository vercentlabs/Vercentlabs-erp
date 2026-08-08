# Phase 7 Experiment Framework — Decision

## Decision: infrastructure documented, no framework code built, no live experiment run

This phase does **not** ship an `Experiment` type, an assignment utility, or an exposure-event mechanism. This is a deliberate decision, not an oversight — the governing brief is explicit that experimentation infrastructure should only be built where it creates real near-term value, and this site currently has zero of the preconditions an A/B test requires:

1. **No production traffic.** The site is not deployed; there is no visitor stream to split into variants. Building a stable, SSR-safe, flicker-free assignment mechanism now would be validated against nothing.
2. **No sample-size case.** Every CRO idea in `cro-hypothesis-backlog.md` is, at this stage, a single-digit-page site with an unknown, unmeasured baseline conversion rate. There is no traffic estimate to run a power calculation against, and "we'll figure out sample size later" is exactly the anti-pattern the brief warns against — infrastructure without a use case invites shipping meaningless tests just to justify the infrastructure's existence.
3. **No confirmed-vs-hypothesis split exists yet to even assign priority.** This phase's own CRO work (`cro-heuristic-audit.md`) found real, confirmed usability defects (fixed directly, not A/B tested — per the brief's own instruction not to test defects) and a set of genuine hypotheses (`cro-hypothesis-backlog.md`) that have no live-traffic validation path until the site launches and accumulates baseline data.

Building the framework now would be premature in the specific sense the brief warns about: work with no near-term consumer, done "because the brief mentioned it" rather than because it's needed.

## What a future phase should build, when the precondition (real traffic) exists

This is documented now so a future phase doesn't have to re-derive the requirements from scratch:

```typescript
interface Experiment<VariantId extends string = string> {
  id: string;
  status: "draft" | "running" | "concluded";
  variants: readonly VariantId[];
  /** Which surface/route this experiment applies to — for scoping, not targeting logic. */
  scope: string;
}
```

Requirements for the assignment utility, all non-negotiable per the governing brief:

- **Deterministic, stable assignment** — a hash of a stable, non-PII visitor identifier (e.g., a first-party random ID already established at first touch, not derived from IP/user-agent/fingerprinting) mapped into a variant bucket, so the same visitor always sees the same variant across sessions.
- **SSR-safe, no flicker** — the variant must be resolvable during server rendering (or resolved before first paint client-side) so there is no visible content swap after hydration. A cookie-based or `localStorage`-read-before-paint pattern, not a client-only `useEffect` that swaps content in after mount.
- **A real exposure event** — fired once per assignment, feeding the same `track()` pipeline every other event uses, carrying the experiment id and variant id as safe, non-PII properties (both already fit within `SafeAnalyticsProperties`'s existing shape without needing new fields).
- **No PII in assignment or reporting** — the assignment identifier must not be a name/email/phone; it should be the same kind of first-party, non-identifying id `lib/attribution.ts` already establishes.
- **No SEO cloaking** — crawlers must always see the same canonical content as the control variant (or a stable, non-randomized default), never content that differs based on user-agent sniffing.
- **No user-agent targeting of any kind** — assignment must be based on the visitor identifier, never on browser/OS/device sniffing, which would both bias results and risk crawler-vs-user content divergence.
- **Easy removal** — once an experiment concludes, removing it should mean deleting the `Experiment` entry and the conditional render, not unwinding a deep integration. This argues for keeping the abstraction thin (a single hook or utility function, not a provider/context tree) when it is eventually built.
- **No heavyweight vendor** — consistent with this phase's other scope decisions (no analytics vendor, no RUM vendor), the first real experiment should ship with the smallest possible first-party implementation, not a dedicated experimentation platform, unless a specific experiment's complexity later justifies one.

## When to revisit this decision

Once the site is deployed and has accumulated enough traffic for `baseline-measurements.md`'s Lighthouse/lab numbers to be supplemented by real field data (see `performance-methodology.md`), and once `cro-hypothesis-backlog.md` has at least one hypothesis with a plausible sample-size path, building the minimal framework above becomes justified. Not before.
