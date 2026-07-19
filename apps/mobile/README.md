# Vercent ERP Mobile

The native CRM workspace for Android and iOS. It is built with Expo SDK 57,
Expo Router, strict TypeScript and the public `/api/mobile/v1` contract.

## Local setup

1. Use Node 24 and pnpm 11.13.0.
2. Copy `.env.example` to `.env.local` and set the public API origin.
3. Run `pnpm dev:mobile` from the repository root.
4. Use a development build for encrypted SQLite, Face ID and push features.

The mobile app may import shared packages, but must never import from `apps/web`
or `services/api` directly.
