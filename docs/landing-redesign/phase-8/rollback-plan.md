# Phase 8 Rollback Plan

## Why this is comparatively simple for `apps/landing`

`apps/landing` has **no database migration, no persistent state of its own, and no data written anywhere by the landing site itself** (confirmed throughout this phase: zero cookies, only client-side `localStorage`/`sessionStorage` which the server never reads back — see `cookie-storage-audit.md`). A rollback is purely a matter of reverting to a previous deployed build — there is no database rollback question to answer, per this workstream's own instruction not to propose one where no migration exists.

## Last known-good commit

At the time this phase's work is committed, the last known-good commit **before any Phase 8 change** is the final Phase 7 commit: `7074d77` (`docs(landing): document phase 7 CRO, accessibility, performance, and observability work`) — the tip of `main` at the start of this phase, itself already verified via Phase 7's own full Cycle 3 regression (578/578 passing). This phase's own final release-candidate SHA is recorded in `final-release-report.md` once all commits land.

## Deployment rollback mechanism (by path)

- **Direct Node process (Hostinger):** revert to the last known-good commit (`git revert` or redeploying the prior commit SHA, depending on Hostinger's actual deploy trigger — not documented in this repo, see `deployment-rehearsal.md`'s disclosed gap), then re-run the same build/boot sequence (`pnpm build:landing` → `node server.js`). Because there's no database state, this is a clean, complete rollback with no data-consistency concern.
- **Docker:** redeploy the previously-tagged image (or rebuild from the last known-good commit) — the same statelessness applies.
- **Kubernetes** (if that path is actually used — unrehearsed this phase): a standard `kubectl rollout undo` against the previous ReplicaSet, assuming the deployment is managed as a standard rolling-update Deployment resource (inferred from `infrastructure/kubernetes/base/apps.yaml`'s existence, not independently verified this phase).

## Environment/config rollback

If a Phase 8 environment-variable change (e.g., a newly-required variable) causes a startup failure, the rollback is simply not deploying that change — since `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_APP_URL` are the only environment-contract items this phase's work touches indirectly (via the new `/privacy`/`/terms` routes, which don't introduce any new required variable), there is no new environment-variable rollback scenario this phase introduces.

## CRM/lead-delivery impact

A rollback of `apps/landing` has **no impact on already-delivered leads** — `apps/web`'s CRM system, where lead data actually lives, is a separate application/deployment, unaffected by rolling back the marketing site. The one operational risk: if a rollback removes a bug fix Phase 7/8 shipped (e.g., the double-submission fix), duplicate-lead risk would return for the rollback's duration — a real, if minor, consideration to weigh against whatever issue prompted the rollback in the first place.

## DNS/cache considerations

- **DNS:** not touched by any landing-site deployment — the domain (`vercentlabs.com`) itself isn't something this phase's rollback plan needs to reconfigure; only the application behind it changes.
- **CDN/cache:** if a CDN sits in front of the deployment (not confirmed either way in this repo — no CDN configuration exists in `infrastructure/`), a rollback should be paired with a cache purge for changed routes, otherwise stale (bad) content could continue serving from cache after the application itself has been reverted. Flagged as a real open question for whoever owns the actual hosting configuration, not resolved here since no CDN config exists in this repo to inspect.

## Rollback decision criteria (when to actually roll back vs. fix forward)

Consistent with this project's own release-blocker classification (`launch-readiness-scorecard.md`): a genuine BLOCKER discovered post-launch (broken CRM delivery, a dead primary CTA, a 500 on the homepage) warrants an immediate rollback rather than a fix-forward attempt under pressure. A HIGH or lower-severity issue (e.g., a cosmetic cross-browser difference) does not.
