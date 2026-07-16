# VercentLabs ERP

VercentLabs ERP is a pnpm monorepo containing the public landing site, the authenticated ERP web application, shared packages, API services, database migrations, and deployment infrastructure.

## Getting started

Use the package manager declared in the root manifest:

```sh
pnpm install --frozen-lockfile
pnpm typecheck:landing
pnpm typecheck:web
pnpm test:web
```

See [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for repository boundaries and the application READMEs for environment-specific setup.
