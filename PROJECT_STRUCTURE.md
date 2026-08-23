# Project Structure

```text
vercentlabs/
├── apps/
│   ├── landing/          # public site (separate surface)
│   ├── mobile/           # native app (separate surface)
│   └── web/              # authenticated ERP
├── services/
│   ├── api/              # ERP domain services
│   └── worker/           # durable jobs/scheduler/outbox delivery
├── packages/             # reusable contracts, permissions, DB, UI and engines
├── database/
│   ├── platform/         # identity/access/SaaS platform
│   └── tenant/           # operational ERP data
├── infrastructure/
├── scripts/
├── tests/
└── docs/
```

## ERP web

`apps/web/src/app` is routing only. Shared platform code belongs to `core`, business code to one of the 12 module roots, and framework-neutral/generic web primitives to `shared`.

## ERP API

`services/api/src/modules/<module>/index.js` is that module's public contract. Cross-module private imports are forbidden. Coordinated multi-module workflows belong in `services/api/src/orchestration`.

## Features

Do not create 510 top-level implementation directories. The 510 IDs are requirement/evidence identifiers. Implementation is grouped by business capability under each module's `features/` folder so feature 511+ can be added without another repository-wide restructure.
