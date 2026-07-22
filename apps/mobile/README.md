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

## Native project policy

`android/` and `ios/` are generated locally from `app.config.ts` and the Expo
config plugins. The Android and iOS scripts always run Expo Prebuild before a
native build so checked-in or cached native files cannot silently drift from
the application configuration.

## Session and offline boundary

The app uses one authenticated API client. Offline SQLite data and queued
mutations are bound to the signed-in user and organization and are purged when
that boundary changes. Connectivity listeners flush writes only while a valid
session is active.
